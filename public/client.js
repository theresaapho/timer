const socket = io();

let myId = '';
let roomId = '';
let username = '';
let isHost = false;
let roomState = null;
let wakeLock = null; 

let titleInterval = null;
const originalTitle = document.title;

// Tự động nạp thông tin phòng đã chơi gần nhất (Local Cache)
document.getElementById('inputUsername').value = localStorage.getItem('timer_pro_username') || '';
document.getElementById('inputRoomId').value = localStorage.getItem('timer_pro_roomid') || '';

// Đăng ký quyền thông báo đẩy của hệ thống
if ('Notification' in window) {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock is active.');
        }
    } catch (err) {}
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
    }
}

function playAlarmBeep() {
    if (roomState && !roomState.soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 460;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) {}
}

function startFlashingTitle() {
    if (titleInterval) clearInterval(titleInterval);
    let toggle = false;
    titleInterval = setInterval(() => {
        document.title = toggle ? "⚠ TIME'S UP! ⚠" : originalTitle;
        toggle = !toggle;
    }, 1000);
}

function stopFlashingTitle() {
    if (titleInterval) {
        clearInterval(titleInterval);
        titleInterval = null;
    }
    document.title = originalTitle;
}

// Phím tắt TAB đóng/mở Sidebar
window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        document.getElementById('sidebar').classList.toggle('collapsed');
    }
});

function joinRoom() {
    username = document.getElementById('inputUsername').value.trim();
    let rId = document.getElementById('inputRoomId').value.trim().toUpperCase();

    if (!username) { alert("Please enter your name!"); return; }
    
    if (!rId) {
        roomId = 'ROOM_' + Math.random().toString(36).substr(2, 5).toUpperCase();
        isHost = true;
    } else {
        roomId = rId;
        isHost = false;
    }

    localStorage.setItem('timer_pro_username', username);
    localStorage.setItem('timer_pro_roomid', roomId);

    myId = socket.id;
    socket.emit('join-room', { roomId, username, isHost });

    document.getElementById('screenJoin').style.display = 'none';
    document.getElementById('screenMain').style.display = 'flex';
    document.getElementById('lblRoomId').innerText = roomId;

    setupHostConfigListeners();
}

function setupHostConfigListeners() {
    if (!isHost) return;
    document.getElementById('hostConfig').style.display = 'block';
    document.getElementById('btnHostPause').style.display = 'block';

    // Đổi bộ lắng nghe sự kiện sang checkbox checkNotifyAll mới
    document.getElementById('checkNotifyAll').addEventListener('change', (e) => {
        socket.emit('set-sync-notification', e.target.checked);
    });

    document.getElementById('checkSound').addEventListener('change', (e) => {
        socket.emit('set-sound', e.target.checked);
    });

    const checkAccumulate = document.getElementById('checkAccumulate');
    const maxAccumulateGroup = document.getElementById('maxAccumulateGroup');
    const inputMaxAccumulate = document.getElementById('inputMaxAccumulate');

    checkAccumulate.addEventListener('change', () => {
        const isEnabled = checkAccumulate.checked;
        maxAccumulateGroup.style.display = isEnabled ? 'block' : 'none';
        socket.emit('set-accumulate', { enabled: isEnabled, maxSec: parseInt(inputMaxAccumulate.value) || 30 });
    });

    inputMaxAccumulate.addEventListener('input', () => {
        socket.emit('set-accumulate', { enabled: checkAccumulate.checked, maxSec: parseInt(inputMaxAccumulate.value) || 30 });
    });
}

socket.on('update-room', (state) => {
    roomState = state;
    renderPlayerList();
});

socket.on('update-sound', (enabled) => {
    if (isHost) return;
    document.getElementById('checkSound').checked = enabled;
});

// Đồng bộ trạng thái checkbox giữa các máy khách khi Host chỉnh sửa
socket.on('update-sync-notification', (enabled) => {
    if (isHost) return;
    document.getElementById('checkNotifyAll').checked = enabled;
});

socket.on('update-accumulate', (data) => {
    if (isHost) return;
    document.getElementById('checkAccumulate').checked = data.enabled;
    document.getElementById('maxAccumulateGroup').style.display = data.enabled ? 'block' : 'none';
    document.getElementById('inputMaxAccumulate').value = data.maxSec;
});

function renderPlayerList() {
    const container = document.getElementById('playerListContainer');
    container.innerHTML = '';

    roomState.players.forEach((player, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        if (roomState.status === 'playing' && idx === roomState.activePlayerIndex) {
            item.classList.add('active-turn');
        }

        const bonusText = roomState.accumulateUnused && player.timeBank > 0 ? ` (+${player.timeBank}s)` : '';

        item.innerHTML = `
            <span>${idx + 1}. ${player.name} ${player.id === socket.id ? '(You)' : ''} <span style="color:#ffcc00; font-weight:bold;">${bonusText}</span></span>
            ${player.isHost ? '<span class="badge">Host</span>' : ''}
        `;

        if (roomState.status === 'lobby' && isHost) {
            item.setAttribute('draggable', 'true');
            setupDragAndDropEvents(item, player.id);
        }

        container.appendChild(item);
    });
}

let dragSrcId = null;
function setupDragAndDropEvents(element, playerId) {
    element.addEventListener('dragstart', (e) => {
        element.classList.add('dragging');
        dragSrcId = playerId;
        e.dataTransfer.effectAllowed = 'move';
    });

    element.addEventListener('dragover', (e) => { e.preventDefault(); });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetId = playerId;
        if (dragSrcId !== targetId) {
            const playerIds = roomState.players.map(p => p.id);
            const srcIdx = playerIds.indexOf(dragSrcId);
            const targetIdx = playerIds.indexOf(targetId);

            playerIds.splice(srcIdx, 1);
            playerIds.splice(targetIdx, 0, dragSrcId);

            socket.emit('reorder-players', playerIds);
        }
    });

    element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
    });
}

function hostStartGame() {
    const duration = parseInt(document.getElementById('inputDuration').value) || 45;
    socket.emit('start-game', duration);
}

socket.on('game-started', (state) => {
    roomState = state;
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('gameView').style.display = 'block';
    requestWakeLock();
});

socket.on('start-countdown', (data) => {
    roomState.activePlayerIndex = data.activePlayerIndex;
    
    const activePlayer = roomState.players[data.activePlayerIndex];
    document.getElementById('activePlayerName').innerText = activePlayer.name;

    const badge = document.getElementById('bonusTimeBadge');
    if (roomState.accumulateUnused && data.timeBank > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = `Time Bank: +${data.timeBank}s`;
    } else {
        badge.style.display = 'none';
    }

    renderPlayerList();
    updateTimerUI(data.duration, data.paused);

    const btnEndTurn = document.getElementById('btnEndTurn');
    if (activePlayer.id === socket.id) {
        btnEndTurn.disabled = false;
        btnEndTurn.style.opacity = '1';
    } else {
        btnEndTurn.disabled = true;
        btnEndTurn.style.opacity = '0.3';
    }
});

socket.on('timer-tick', (data) => {
    updateTimerUI(data.timeLeft, data.paused);
});

function updateTimerUI(timeLeft, paused) {
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.innerText = timeLeft < 10 ? `0${timeLeft}` : timeLeft;

    if (timeLeft <= 10) {
        timerDisplay.classList.add('warning');
    } else {
        timerDisplay.classList.remove('warning');
    }

    if (paused) {
        timerDisplay.classList.add('paused');
        document.getElementById('btnHostPause').innerText = "RESUME";
    } else {
        timerDisplay.classList.remove('paused');
        document.getElementById('btnHostPause').innerText = "PAUSE";
    }
}

// Báo động: Đã gỡ bỏ toàn bộ code Fullscreen bám đuôi cũ
socket.on('time-out-alarm', (data) => {
    playAlarmBeep();
    
    const overlay = document.getElementById('alarmOverlay');
    const activePlayer = roomState.players[roomState.activePlayerIndex];

    document.getElementById('alarmMessage').innerText = `Turn time for [ ${data.activePlayerName} ] has expired!`;
    
    overlay.style.display = 'flex';

    if (activePlayer.id === socket.id) {
        document.getElementById('btnAlarmNext').style.display = 'block';
        document.getElementById('btnAlarmOK').style.display = 'none';
    } else {
        document.getElementById('btnAlarmNext').style.display = 'none';
        document.getElementById('btnAlarmOK').style.display = 'block';
    }

    // Luôn nhấp nháy Tab tiêu đề
    startFlashingTitle(); 

    // Gửi thông báo hệ thống đè lên màn hình
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification("TIME'S UP!", {
            body: `Turn time for [ ${data.activePlayerName} ] has expired! Click to return.`,
            requireInteraction: true 
        });

        notification.onclick = function() {
            window.focus(); // Tập trung lại ứng dụng để đưa họ quay lại game dứt khoát
            notification.close();
            stopFlashingTitle();
        };
    }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        stopFlashingTitle(); 
    }
});

socket.on('close-alarm-overlay', () => {
    document.getElementById('alarmOverlay').style.display = 'none';
    stopFlashingTitle();
});

function togglePause() {
    if (isHost) socket.emit('toggle-pause');
}

function exitAlarmAndNext() {
    stopFlashingTitle();
    document.getElementById('alarmOverlay').style.display = 'none';
    socket.emit('end-turn');
}

function exitAlarmOK() {
    stopFlashingTitle();
    document.getElementById('alarmOverlay').style.display = 'none';
}

function clientEndTurn() {
    socket.emit('end-turn');
}

function exitGame() {
    if (confirm("Are you sure you want to exit the room?")) {
        releaseWakeLock(); 
        socket.disconnect();
        window.location.href = window.location.pathname;
    }
}