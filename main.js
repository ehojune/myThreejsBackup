import * as CANNON from 'cannon-es/dist/cannon-es.js'
import * as THREE from 'three/build/three.module.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { PointerLockControlsCannon } from 'cannon-es/examples/js/PointerLockControlsCannon.js'
import { VoxelLandscape } from 'cannon-es/examples/js/VoxelLandscape.js'

import { Interaction } from 'three.interaction';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

/**
 * Example construction of a voxel world and player.
 */

    // three.js variables
let camera, scene, renderer, stats
let material
let floor

// cannon.js variables
let world
let controls
const timeStep = 1 / 60
let lastCallTime = performance.now() / 1000
let sphereShape
let sphereBody
let physicsMaterial
let voxels

const balls = []
const ballMeshes = []
const boxes = []
const boxMeshes = []

// Number of voxels
const nx = 50
const ny = 8
const nz = 50

// Scale of voxels
const sx = 0.5
const sy = 0.5
const sz = 0.5

initThree()
initCannon()
initPointerLock()
animate()

function initThree() {
    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

    // Scene
    scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x000000, 0, 500)

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(scene.fog.color)

    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    document.body.appendChild(renderer.domElement)

    // Stats.js
    stats = new Stats()
    document.body.appendChild(stats.dom)

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.1)
    scene.add(ambientLight)

    const spotlight = new THREE.SpotLight(0xffffff, 0.7, 0, Math.PI / 4, 1)
    spotlight.position.set(10, 30, 20)
    spotlight.target.position.set(0, 0, 0)

    spotlight.castShadow = true

    spotlight.shadow.camera.near = 20
    spotlight.shadow.camera.far = 50
    spotlight.shadow.camera.fov = 40

    spotlight.shadow.bias = -0.001
    spotlight.shadow.mapSize.width = 2048
    spotlight.shadow.mapSize.height = 2048

    scene.add(spotlight)

    // Generic material
    material = new THREE.MeshLambertMaterial({ color: 0xdddddd })

    // Floor
    const floorGeometry = new THREE.PlaneBufferGeometry(300, 300, 50, 50)
    floorGeometry.rotateX(-Math.PI / 2)
    floor = new THREE.Mesh(floorGeometry, material)
    floor.receiveShadow = true
    scene.add(floor)

    window.addEventListener('resize', onWindowResize)
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}

function initCannon() {
    // Setup world
    world = new CANNON.World()

    // Tweak contact properties.
    // Contact stiffness - use to make softer/harder contacts
    world.defaultContactMaterial.contactEquationStiffness = 1e9

    // Stabilization time in number of timesteps
    world.defaultContactMaterial.contactEquationRelaxation = 4

    const solver = new CANNON.GSSolver()
    solver.iterations = 7
    solver.tolerance = 0.1
    world.solver = new CANNON.SplitSolver(solver)
    // use this to test non-split solver
    // world.solver = solver

    world.gravity.set(0, -20, 0)

    world.broadphase.useBoundingBoxes = true

    // Create a slippery material (friction coefficient = 0.0)
    physicsMaterial = new CANNON.Material('physics')
    const physics_physics = new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, {
        friction: 0.0,
        restitution: 0.3,
    })

    // We must add the contact materials to the world
    world.addContactMaterial(physics_physics)

    // Create the user collision sphere
    const radius = 1.3
    sphereShape = new CANNON.Sphere(radius)
    sphereBody = new CANNON.Body({ mass: 5, material: physicsMaterial })
    sphereBody.addShape(sphereShape)
    sphereBody.position.set(nx * sx * 0.5, ny * sy + radius * 2, nz * sz * 0.5)
    sphereBody.linearDamping = 0.9
    world.addBody(sphereBody)

    // Create the ground plane
    const groundShape = new CANNON.Plane()
    const groundBody = new CANNON.Body({ mass: 0, material: physicsMaterial })
    groundBody.addShape(groundShape)
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    world.addBody(groundBody)

    // Voxels
    voxels = new VoxelLandscape(world, nx, ny, nz, sx, sy, sz)

    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            for (let k = 0; k < nz; k++) {
                let filled = true

                // Insert map constructing logic here
                if (Math.sin(i * 0.1) * Math.sin(k * 0.1) < (j / ny) * 2 - 1) {
                    filled = false
                }

                voxels.setFilled(i, j, k, filled)
            }
        }
    }

    voxels.update()

    console.log(`${voxels.boxes.length} voxel physics bodies`)

    // Voxel meshes
    for (let i = 0; i < voxels.boxes.length; i++) {
        const box = voxels.boxes[i]
        const voxelGeometry = new THREE.BoxBufferGeometry(voxels.sx * box.nx, voxels.sy * box.ny, voxels.sz * box.nz)
        const voxelMesh = new THREE.Mesh(voxelGeometry, material)
        voxelMesh.castShadow = true
        voxelMesh.receiveShadow = true
        boxMeshes.push(voxelMesh)
        scene.add(voxelMesh)
    }

    // The shooting balls
    const shootVelocity = 15
    const ballShape = new CANNON.Sphere(0.2)
    const ballGeometry = new THREE.SphereBufferGeometry(ballShape.radius, 32, 32)

    // Returns a vector pointing the the diretion the camera is at
    function getShootDirection() {
        const vector = new THREE.Vector3(0, 0, 1)
        vector.unproject(camera)
        const ray = new THREE.Ray(sphereBody.position, vector.sub(sphereBody.position).normalize())
        return ray.direction
    }

    window.addEventListener('click', (event) => {
        if (!controls.enabled) {
            return
        }

        const ballBody = new CANNON.Body({ mass: 1 })
        ballBody.addShape(ballShape)
        const ballMesh = new THREE.Mesh(ballGeometry, material)

        ballMesh.castShadow = true
        ballMesh.receiveShadow = true

        world.addBody(ballBody)
        scene.add(ballMesh)
        balls.push(ballBody)
        ballMeshes.push(ballMesh)

        const shootDirection = getShootDirection()
        ballBody.velocity.set(
            shootDirection.x * shootVelocity,
            shootDirection.y * shootVelocity,
            shootDirection.z * shootVelocity
        )

        // Move the ball outside the player sphere
        const x = sphereBody.position.x + shootDirection.x * (sphereShape.radius * 1.02 + ballShape.radius)
        const y = sphereBody.position.y + shootDirection.y * (sphereShape.radius * 1.02 + ballShape.radius)
        const z = sphereBody.position.z + shootDirection.z * (sphereShape.radius * 1.02 + ballShape.radius)
        ballBody.position.set(x, y, z)
        ballMesh.position.copy(ballBody.position)
    })
}

function initPointerLock() {
    controls = new PointerLockControlsCannon(camera, sphereBody)
    scene.add(controls.getObject())

    instructions.addEventListener('click', () => {
        controls.lock()
    })

    controls.addEventListener('lock', () => {
        controls.enabled = true
        instructions.style.display = 'none'
    })

    controls.addEventListener('unlock', () => {
        controls.enabled = false
        instructions.style.display = null
    })
}

function animate() {
    requestAnimationFrame(animate)

    const time = performance.now() / 1000
    const dt = time - lastCallTime
    lastCallTime = time

    if (controls.enabled) {
        world.step(timeStep, dt)

        // Update ball positions
        for (let i = 0; i < balls.length; i++) {
            ballMeshes[i].position.copy(balls[i].position)
            ballMeshes[i].quaternion.copy(balls[i].quaternion)
        }

        // Update box positions
        for (let i = 0; i < voxels.boxes.length; i++) {
            boxMeshes[i].position.copy(voxels.boxes[i].position)
            boxMeshes[i].quaternion.copy(voxels.boxes[i].quaternion)
        }
    }

    controls.update(dt)
    renderer.render(scene, camera)
    stats.update()
}