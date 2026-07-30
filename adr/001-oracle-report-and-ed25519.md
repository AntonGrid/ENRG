ADR‑001: OracleReport и Ed25519‑подписи в ENRG Core
Статус
Accepted (draft implementation, MVP stack).

Контекст
ENRG Core должен безопасно принимать доказательства выработки энергии от физических устройств через оракулы. Ключевые требования:

Подлинность данных устройства
Подпись ставит сам девайс (Ed25519‑ключ), а не оракул или продюсер.

Отделение сбора данных от верификации

Девайс → шлёт сырое измерение и подпись.
Оракул → проверяет подпись, дополняет отчёт служебными полями (oracle, verified_at, nonce) и отправляет в протокол.
Невозможность повторного использования отчётов (replay)

Последовательный nonce на уровне продюсера.
Временные ограничения по verified_at (временная проверка может быть ослаблена на MVP‑этапе, но путь к продакшн‑проверке должен быть прозрачен).
Детерминированность формата сообщения
Подписанное сообщение должно быть:

чётко описано;
однозначно сериализуемо на Rust/TS/Python и т.д.;
не зависеть от внутренних представлений структур (TLV/Borsh и т.п.).
На MVP‑этапе реальная on‑chain проверка Ed25519 может быть временно заглушена (для стабилизации флоу и тестовой экономики), но архитектурный контракт и формат OracleReport должны быть уже финализированы — это «шарнир», вокруг которого строится вся остальная логика.

Решение
1. Структура OracleReport
OracleReport — единственный доверенный объект, который Core принимает от off‑chain мира:

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OracleReport {
    /// Trusted Oracle identity.
    pub oracle: Pubkey,

    /// Producer device.
    pub device_id: Pubkey,

    /// Sequential proof number.
    pub nonce: u64,

    /// Original device timestamp (seconds since Unix epoch).
    pub device_timestamp: i64,

    /// Oracle verification timestamp (seconds since Unix epoch).
    pub verified_at: i64,

    /// Verified energy (in Wh).
    pub energy_wh: u64,

    /// Original device signature (Ed25519, 64 bytes).
    pub device_signature: [u8; 64],
}
Смысл полей:

oracle — Solana‑аккаунт доверенного оракула. Используется для:
проверки, что отчёт подписан whitelisted‑оракулом (через OracleRegistry);
логирования и аудит‑следа.
device_id — публичный ключ устройства (Ed25519 → Solana Pubkey), по которому:
верифицируется подпись;
линкуется отчёт к EnergyProducer.
nonce — монотонно возрастающий номер доказательства на уровне продюсера (а не девайса):
для каждого EnergyProducer хранится producer.nonce;
протокол требует report.nonce > producer.nonce.
device_timestamp — исходный timestamp девайса (секунды, UTC, unix epoch):
может использоваться оракулом для внутренних проверок;
на ончейне не критичен, но входит в подписываемое сообщение.
verified_at — время проверки оракулом (секунды, UTC, unix epoch):
используется ончейном для проверки свежести (now - verified_at <= Δ);
может временно логироваться без строгого require! (MVP).
energy_wh — верифицированная энергия в ватт‑часах за интервал, к которому относится отчёт.
device_signature — неизменённая Ed25519‑подпись девайса над детерминированным сообщением (см. ниже).
2. Подписываемое сообщение message_to_sign()
Устройство подписывает только часть полей отчёта:

impl OracleReport {
    /// Serialize report fields excluding signature.
    /// This produces the exact message that was signed by the device.
    pub fn message_to_sign(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(8 + 8 + 8 + 8);

        // Serialize only the fields the device signs:
        // device_id + nonce + device_timestamp + energy_wh
        buf.extend_from_slice(&self.device_id.to_bytes());
        buf.extend_from_slice(&self.nonce.to_le_bytes());
        buf.extend_from_slice(&self.device_timestamp.to_le_bytes());
        buf.extend_from_slice(&self.energy_wh.to_le_bytes());

        Ok(buf)
    }
}
Таким образом:

Подписываемое сообщение — точно определённая последовательность байтов:

device_id — 32 байта, как Pubkey::to_bytes().
nonce — 8 байт, u64::to_le_bytes().
device_timestamp — 8 байт, i64::to_le_bytes().
energy_wh — 8 байт, u64::to_le_bytes().
Оракул не может подменить эти значения, не сломав подпись.

Служебные поля (oracle, verified_at) не подписываются девайсом:

они добавляются и подписываются самим оракулом уже в отдельном off‑chain протоколе (если требуется),
но ончейн Core доверяет только проверке Ed25519 на устройстве и собственной whitelist‑проверке оракула.
3. Ончейн‑верификация Ed25519
Ончейн‑проверка выполняется в mint_energy:

let message = report.message_to_sign()?;

verify_ed25519_signature(
    &report.device_signature,
    &report.device_id.to_bytes(),
    &message,
    &ctx.accounts.instructions.to_account_info(),
)?;
Целевое (prod‑ready) поведение verify_ed25519_signature:

Ожидается, что в транзакции перед mint_energy уже добавлена ed25519_program‑инструкция, созданная с тем же publicKey, message, signature.
Внутри verify_ed25519_signature:
читается SysvarInstructions (SYSVAR_INSTRUCTIONS_PUBKEY);
в списке инструкций текущей транзакции ищется валидная Ed25519Program‑инструкция:
program_id == ed25519_program::id();
поля инструкции (pubkey, msg, sig) совпадают с переданными в функцию;
при успешном совпадении функция возвращает Ok(()), иначе — Err(ErrorCode::InvalidSignature).
MVP‑состояние (на момент этой ADR):

На ончейне реализован «legacy stub»:
формат сообщения зафиксирован через message_to_sign;
создаётся и логируется Ed25519‑инструкция;
но фактическая верификация может быть ослаблена (например, пропускается, но логируются первые байты ключа, msg_len, sig_len).
Это позволяет:
стабилизировать интеграционные тесты;
не блокировать работу над экономикой/флоу;
при этом не ломать будущий интерфейс.
4. Проверка nonce и времени
Nonce:

Для каждого EnergyProducer хранится producer.nonce.

В mint_energy выполняется:

msg!(
    "DEBUG NONCE report={} producer={}",
    report.nonce,
    producer.nonce
);
verify_nonce(producer, report.nonce)?;
Целевое поведение verify_nonce:

требовать строгий рост report.nonce > producer.nonce;
обновлять producer.nonce = report.nonce при успешном отчёте.
Время:

В mint_energy доступны:

now = Clock::get()?.unix_timestamp;
report.verified_at (секунды, unix epoch).
Целевое поведение (включается ближе к mainnet):

verify_timestamp(now, report.verified_at)?;
с инвариантами:

verified_at <= now + ε_future (слабый допуск в будущее, если нужно);
now - verified_at <= MAX_REPORT_AGE.
В MVP временная проверка может быть временно отключена (пишем в лог, но не фейлим транзакцию), чтобы:

не «ловить» артефакты локального тестового времени;
упростить дебаг Ed25519/nonce/экономики.
5. Интеграционный сценарий (etalon‑flow)
Типовой ончейн‑вызов MintEnergy в интеграционном тесте:

Собираем сообщение точно как message_to_sign():

function buildOracleMessage({
  deviceId,
  nonce,
  deviceTimestamp,
  energyWh,
}): Buffer {
  const le64 = (v: BN) => Buffer.from(v.toArray("le", 8));

  return Buffer.concat([
    Buffer.from(deviceId.toBytes()), // 32
    le64(nonce),                     // 8
    le64(deviceTimestamp),           // 8
    le64(energyWh),                  // 8
  ]);
}
Устройство подписывает message Ed25519‑ключом:

const message = buildOracleMessage({ deviceId, nonce, deviceTimestamp, energyWh });
const signature = nacl.sign.detached(message, deviceKeypair.secretKey);
Формируем Ed25519Program.createInstructionWithPublicKey({ publicKey, message, signature }) и кладём его первым в транзакцию.

Собираем report как один аргумент для Anchor (не report: { ... }, а именно struct):

const report = {
  oracle: oracleKeypair.publicKey,
  deviceId,
  nonce,
  deviceTimestamp,
  verifiedAt: now,
  energyWh,
  deviceSignature: Array.from(signature),
};

const mintIx = await program.methods
  .mintEnergy(report)
  .accounts({ /* ... */ })
  .instruction();
В одну транзакцию добавляем:

const tx = new Transaction().add(ed25519Ix, mintIx);
и отправляем её.

6. Инварианты
Формат сообщения:

Длина всегда 56 байт.
Порядок полей и endianness фиксированы и не должны меняться без миграции протокола.
Защита от replay:

Для каждого EnergyProducer:
report.nonce > producer.nonce (жёсткий порядок).
Повторное использование старого nonce должно приводить к отказу.
Связь с экономикой:

report.energy_wh > 0 для meaningful отчётов;
calculate_reward(report.energy_wh, vault.total_supply) никогда не возвращает значение, приводящее к переполнению vault.total_supply или превышению max_supply.
Безопасность ключей:

Приватный ключ девайса нигде не фигурирует ончейн;
device_id задаётся при create_producer и впоследствии неизменяем.
Альтернативы
Рассматривались и отклонены:

Подписывать всё содержимое OracleReport
Минусы:

оракул не может дополнять отчёт служебными полями (например, менять verified_at в разумных пределах) без участия устройства;
усложняется эволюция отчётного формата — каждое новое поле ломает протокол подписи девайса.
Использовать сериализацию Borsh/TLV целой структуры как message
Минусы:

сильная привязка к внутреннему формату (порядку полей/атрибутов);
повышенный риск рассинхронизации реализаций на разных языках.
Проверять Ed25519 подпись полностью в Rust без использования ed25519_program
Минусы:

больше compute units;
дублирование функционала системного precompile.
Последствия
Положительные
Чётко определённый протокольный формат подписи (message_to_sign) — можно:
реализовывать устройства/шлюзы на любом языке;
интегрироваться с внешними системами без знания Anchor.
Прозрачный путь миграции:
сейчас — заглушка с логами;
позже — полноценная верификация, не меняя формат отчётов.
Негативные/ограничения
Любое изменение формата message_to_sign (добавление/удаление полей, смена порядка) — breaking‑change для всех девайсов.
Правильное использование SysvarInstructions и Ed25519Program требует аккуратного построения транзакций и тестов.
