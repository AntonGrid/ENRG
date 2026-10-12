/**
 * ENRG — единый загрузчик IDL.
 *
 * `target/` в `.gitignore`, поэтому в свежем CI-чекауте нет артефактов сборки.
 * Статический `import rawIdl from '../target/idl/enrg_mvp.json'` в таком окружении
 * вообще не даёт модулю загрузиться (MODULE_NOT_FOUND на импорте — до любой
 * логики), из-за чего CI-джобы падали «на ровном месте».
 *
 * Порядок: сначала артефакт сборки, потом закоммиченный `idls/enrg_mvp.json`
 * (идентичен байт-в-байт: тот же адрес, те же 58 инструкций).
 *
 * Пути считаются от корня репозитория через `__dirname`, поэтому модуль можно
 * звать из `tests/**` и `scripts/**` одинаково.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Кандидаты в порядке приоритета: артефакт сборки → закоммиченный IDL. */
export const ENRG_IDL_CANDIDATES: string[] = [
  path.join(REPO_ROOT, 'target', 'idl', 'enrg_mvp.json'),
  path.join(REPO_ROOT, 'idls', 'enrg_mvp.json'),
];

/**
 * Загружает IDL программы `enrg-mvp`.
 * Бросает ошибку, если нет ни артефакта сборки, ни закоммиченной копии.
 */
export function loadEnrgIdl(): any {
  for (const abs of ENRG_IDL_CANDIDATES) {
    try {
      if (!fs.existsSync(abs)) continue;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(abs);
    } catch {
      /* пробуем следующий кандидат */
    }
  }
  throw new Error(
    `ENRG IDL not found. Checked: ${ENRG_IDL_CANDIDATES.join(', ')} — ` +
      'run `anchor build` or restore idls/enrg_mvp.json',
  );
}

/** Путь, из которого реально загрузился IDL (для диагностики). */
export function enrgIdlSource(): string {
  for (const abs of ENRG_IDL_CANDIDATES) {
    if (fs.existsSync(abs)) return abs;
  }
  return '<none>';
}
