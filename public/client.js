const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- PHYSICS BOUNDARIES ---
const MAP_RADIUS = 500; // Must match server.js
// --------------------------

ctx.imageSmoothingEnabled = false; 
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const spriteSheet = new Image();
spriteSheet.src = '/sprites.png';

const SPRITE_SIZE = 32; 
const DRAW_SIZE = 64;   

const ANIMATIONS = {
    IDLE:   { row: 0, maxFrames: 5, speed: 10 },
    RUN:    { row: 1, maxFrames: 8, speed: 4 }, 
    ATTACK: { row: 2, maxFrames: 7, speed: 3 },
    HIT:    { row: 3, maxFrames: 3, speed: 5 },
    DEATH:  { row: 4, maxFrames: 7, speed: 8 }
};

let players = {};
let myId = null;
let playerAnimState = {}; 

socket.on('connect', () => { myId = socket.id; });

socket.on('update', (serverPlayers) => {
    players = serverPlayers;
    updateScoreboard();
    for (let id in playerAnimState) {
        if (!players[id]) delete playerAnimState[id];
    }
});

socket.on('hit', (data) => {
    if(playerAnimState[data.id]) {
        playerAnimState[data.id].action = 'HIT';
        playerAnimState[data.id].frame = 0;
    }
});

function updateScoreboard() {
    if (!myId || !players[myId]) return;
    const p = players[myId];
    document.getElementById('scoreboard').innerText = `HP: ${Math.floor(p.hp)} | Kills: ${p.score}`;
}

const keys = { w: false, a: false, s: false, d: false };

window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) { keys[e.key] = true; socket.emit('input', keys); }
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) { keys[e.key] = false; socket.emit('input', keys); }
});

window.addEventListener('mousemove', (e) => {
    if (!myId || !players[myId]) return;
    const p = players[myId];
    const screenX = (canvas.width / 2) + p.x;
    const screenY = (canvas.height / 2) + p.y;
    const angle = Math.atan2(e.clientY - screenY, e.clientX - screenX);
    socket.emit('aim', angle);
});

window.addEventListener('mousedown', () => {
    socket.emit('attack');
    if (playerAnimState[myId]) {
        playerAnimState[myId].action = 'ATTACK';
        playerAnimState[myId].frame = 0;
    }
});

function getPlayerAction(p, currentState) {
    if (p.hp <= 0) return 'DEATH';
    if (currentState) {
        const anim = ANIMATIONS[currentState.action];
        if ((currentState.action === 'ATTACK' || currentState.action === 'HIT') && 
             currentState.frame < anim.maxFrames - 1) {
            return currentState.action;
        }
    }
    if (p.inputs && (p.inputs.w || p.inputs.a || p.inputs.s || p.inputs.d)) {
        return 'RUN';
    }
    return 'IDLE';
}

function draw() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    // --- CIRCULAR PIT DRAWING ---
    
    // A. Wall
    const WALL_THICKNESS = 40;
    ctx.beginPath();
    ctx.arc(0, 0, MAP_RADIUS + WALL_THICKNESS, 0, Math.PI * 2);
    ctx.fillStyle = '#555'; 
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#222';
    ctx.stroke();

    // B. Floor (Matches Physics)
    ctx.beginPath();
    ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#C2B280'; 
    ctx.fill();

    // C. Border
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#8B4513'; 
    ctx.stroke();

    // D. Decoration
    ctx.beginPath();
    ctx.arc(0, 0, 100, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(139, 69, 19, 0.2)';
    ctx.lineWidth = 10;
    ctx.stroke();
    // ----------------------------

    for (let id in players) {
        const p = players[id];

        if (!playerAnimState[id]) playerAnimState[id] = { action: 'IDLE', frame: 0, timer: 0 };
        const animState = playerAnimState[id];
        
        const currentAction = getPlayerAction(p, animState);
        if (currentAction !== animState.action) {
            animState.action = currentAction;
            animState.frame = 0;
            animState.timer = 0;
        }

        const animConfig = ANIMATIONS[animState.action];
        animState.timer++;
        if (animState.timer >= animConfig.speed) {
            animState.frame++;
            animState.timer = 0;
            if (animState.frame >= animConfig.maxFrames) {
                animState.frame = (animState.action === 'DEATH') ? animConfig.maxFrames - 1 : 0;
                if(animState.action === 'ATTACK' || animState.action === 'HIT') animState.action = 'IDLE';
            }
        }

        const isLookingLeft = Math.abs(p.angle) > Math.PI / 2;

        ctx.save();
        ctx.translate(p.x, p.y);

        ctx.save();
        if (isLookingLeft) {
            ctx.scale(-1, 1); 
        }
        
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(0, 14, 12, 6, 0, 0, Math.PI*2);
        ctx.fill();

        const srcX = animState.frame * SPRITE_SIZE;
        const srcY = animConfig.row * SPRITE_SIZE;
        
        try {
            ctx.drawImage(
                spriteSheet, 
                srcX, srcY, SPRITE_SIZE, SPRITE_SIZE, 
                -DRAW_SIZE/2, -DRAW_SIZE/2, DRAW_SIZE, DRAW_SIZE 
            );
        } catch (e) {}
        ctx.restore(); 

        ctx.save();
        ctx.rotate(p.angle); 
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(30, -5); 
        ctx.lineTo(50, 0);   
        ctx.lineTo(30, 5);   
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = 'red';
        ctx.fillRect(-20, -45, 40, 5);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(-20, -45, 40 * (p.hp / 100), 5);
        
        if (id === myId) {
            ctx.fillStyle = 'white';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText("YOU", 0, -55);
        }

        ctx.restore(); 
    }

    ctx.restore(); 
    requestAnimationFrame(draw);
}

draw();