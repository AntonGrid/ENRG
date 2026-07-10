// Загрузка статистики
document.addEventListener('DOMContentLoaded', function() {
    loadStats();
    document.getElementById('register-device').addEventListener('click', registerDevice);
    document.getElementById('connect-wallet').addEventListener('click', connectWallet);
});

// Функция загрузки статистики с публичного оракула на Render
function loadStats() {
    fetch('https://enrg-oracle.onrender.com/api/v1/stats')
        .then(response => response.json())
        .then(data => {
            document.getElementById('total-energy').innerText = data.total_energy_mwh || 0;
            document.getElementById('active-producers').innerText = data.active_producers || 0;
            document.getElementById('enrg-staked').innerText = data.total_supply || 0;
            console.log('Stats updated: ', data);
        })
        .catch(error => console.error('Error loading stats:', error));
}

// Функция регистрации устройства
function registerDevice() {
    const deviceId = document.getElementById('device-id').value;
    const publicKey = document.getElementById('public-key').value;
    const sourceType = document.getElementById('source-type').value;

    fetch('https://enrg-oracle.onrender.com/api/v1/device/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_id: deviceId, public_key: publicKey, source_type: sourceType })
    })
    .then(response => response.json())
    .then(data => {
        if (data.ok) {
            document.getElementById('registration-message').innerText = '✅ Устройство зарегистрировано!';
            loadStats();
        } else {
            document.getElementById('registration-message').innerText = '❌ Ошибка: ' + (data.error || 'неизвестная ошибка');
        }
    })
    .catch(error => {
        console.error('Ошибка при регистрации устройства:', error);
        document.getElementById('registration-message').innerText = '❌ Ошибка сети. Проверьте, работает ли оракул.';
    });
}

// Функция подключения кошелька Phantom
function connectWallet() {
    if (!window.solana || !window.solana.isPhantom) {
        document.getElementById('wallet-info').innerText = '❌ Phantom Wallet не установлен!';
        return;
    }
    window.solana.connect()
        .then((response) => {
            const walletAddress = response.publicKey.toString();
            document.getElementById('wallet-info').innerText = '✅ Подключен кошелёк: ' + walletAddress;
            fetchBalance(walletAddress);
        })
        .catch((err) => {
            console.error('Ошибка подключения кошелька:', err);
            document.getElementById('wallet-info').innerText = '❌ Ошибка подключения кошелька';
        });
}

// Функция получения баланса (заглушка)
function fetchBalance(walletAddress) {
    // В будущем здесь будет запрос к Solana для получения баланса ENRG
    document.getElementById('wallet-info').innerText += '\n📊 Баланс ENRG можно посмотреть на Solana Explorer';
}
