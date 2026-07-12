// ==========================================================================
// PolyTrack "Booster" block — config + logic
// ==========================================================================
// This is a from-scratch add-on, not a real physics-engine feature.
// polytrack_physics.wasm ships as a precompiled binary with no source in
// this project, so real per-block collision behaviour (like Checkpoint or
// Finish) can't be added to it. This file fakes a boost instead:
//   1. Forces full throttle into the real physics sim while the car is over
//      a booster zone (a genuine, lasting speed/time benefit).
//   2. Nudges the *rendered* car position forward on top of that, to sell a
//      punchier "kick" like a Trackmania turbo pad.
// Because (2) doesn't touch the physics engine's own internal state, the
// car's true simulated position stays behind the rendered one and the
// difference is smoothed back out after leaving the pad. On fast/long pads
// this can look like a small correction/snap right as you exit. That's the
// known trade-off of doing this without engine source — see the chat writeup.
// ==========================================================================

// Edit this list to place booster pads on your track.
//   x, y, z       - world-space centre of the pad (same coordinates the
//                   editor / track uses).
//   yaw           - direction (radians) the booster pushes the car, 0 = +Z.
//                   Match this to the direction traffic flows over the pad.
//   halfWidth     - half the pad's width (left/right size).
//   halfLength    - half the pad's length (the direction cars drive over it).
//   strength      - 1 = normal boost, 2 = roughly twice as strong, etc.
window.BOOST_ZONES = [
    { x: 0, y: 0.1, z: -20, yaw: 0, halfWidth: 1.7, halfLength: 2.2, strength: 1 }
];

// If a booster pushes the car backwards instead of forwards, flip this to -1.
window.BOOST_FORWARD_SIGN = 1;

(function () {
    const state = new WeakMap();

    function isInZone(p, z) {
        const dx = p.x - z.x, dz = p.z - z.z;
        const cos = Math.cos(-z.yaw), sin = Math.sin(-z.yaw);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        return Math.abs(lx) <= z.halfWidth && Math.abs(lz) <= z.halfLength && Math.abs(p.y - z.y) < 1.5;
    }

    // Called every time a car's simulated state updates (setCarState).
    // Mutates carState.position to add the visual "kick", and reports
    // whether the boosting state just flipped on/off so the caller can also
    // force full throttle into the real physics sim.
    window.__applyBoosterHack = function (carInstance, carState) {
        let st = state.get(carInstance);
        if (!st) {
            st = { offset: 0, active: false };
            state.set(carInstance, st);
        }

        const zones = window.BOOST_ZONES || [];
        let zone = null;
        for (const z of zones) {
            if (isInZone(carState.position, z)) { zone = z; break; }
        }

        const wasActive = st.active;
        st.active = !!zone;

        const dt = 1 / 60; // car state updates arrive at a fixed 1kHz sim rate in bursts; this is a smoothing constant, not a real timestep
        const strength = zone ? (zone.strength || 1) : 1;
        const maxOffset = 6 * strength;
        const rampSpeed = 16 * strength;
        const decaySpeed = 10;

        st.offset = zone
            ? Math.min(st.offset + rampSpeed * dt, maxOffset)
            : Math.max(0, st.offset - decaySpeed * dt);

        if (st.offset > 0.001) {
            const q = carState.quaternion;
            const sign = window.BOOST_FORWARD_SIGN || 1;
            const fx = 2 * (q.x * q.z + q.w * q.y) * sign;
            const fy = 2 * (q.y * q.z - q.w * q.x) * sign;
            const fz = (1 - 2 * (q.x * q.x + q.y * q.y)) * sign;
            carState.position.x += fx * st.offset;
            carState.position.y += fy * st.offset;
            carState.position.z += fz * st.offset;
        }

        return { active: st.active, justChanged: st.active !== wasActive };
    };

    window.__isBoosterActive = function (carInstance) {
        const st = state.get(carInstance);
        return !!(st && st.active);
    };

    // Spawns a simple glowing pad + chevron markers for each configured
    // zone, once per scene. Built procedurally (no new model files needed).
    window.__spawnBoosterPads = function (THREE, scene) {
        if (!scene || scene.__boostPadsSpawned) return;
        scene.__boostPadsSpawned = true;

        const zones = window.BOOST_ZONES || [];
        for (const z of zones) {
            const group = new THREE.Group();

            const padGeo = new THREE.BoxGeometry(z.halfWidth * 2, 0.05, z.halfLength * 2);
            const padMat = new THREE.MeshStandardMaterial({
                color: 0x00e5ff,
                emissive: 0x00e5ff,
                emissiveIntensity: 0.9,
                metalness: 0.2,
                roughness: 0.3
            });
            group.add(new THREE.Mesh(padGeo, padMat));

            const chevronMat = new THREE.MeshStandardMaterial({
                color: 0xffa500,
                emissive: 0xffa500,
                emissiveIntensity: 1.2
            });
            const chevronCount = 3;
            for (let i = 0; i < chevronCount; i++) {
                const barGeo = new THREE.BoxGeometry(z.halfWidth * 1.1, 0.06, 0.18);
                const left = new THREE.Mesh(barGeo, chevronMat);
                const right = new THREE.Mesh(barGeo, chevronMat);
                const offsetZ = -z.halfLength * 0.6 + i * (z.halfLength * 0.6);
                left.position.set(-z.halfWidth * 0.28, 0.04, offsetZ);
                right.position.set(z.halfWidth * 0.28, 0.04, offsetZ);
                left.rotation.y = Math.PI / 5;
                right.rotation.y = -Math.PI / 5;
                group.add(left);
                group.add(right);
            }

            group.position.set(z.x, z.y, z.z);
            group.rotation.y = z.yaw;
            scene.add(group);
        }
    };
})();
