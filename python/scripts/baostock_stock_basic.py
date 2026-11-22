"""Fixed data script: BaoStock security basic info (IPO date, delisting date, type, status).

Protocol (see python/worker.py `run`):
  - read ./input.json  {"codes": ["sh.600519", "sz.000001"]}  (1..50 canonical BaoStock codes)
  - write ./out.json   {"rows": [...]} in request order
  - on failure print one line to stderr and exit non-zero (no partial out.json)

`outDate` is an empty string while the security is still listed; it is mapped to JSON null here.
`type` / `status` are numeric flags. A code the server does not return (B shares do this) fails the
whole batch instead of silently emitting fewer rows: the caller asked for a specific list.
"""
import json
import re
import sys
from pathlib import Path

SCRIPT = 'baostock_stock_basic'
CODE_RE = re.compile(r'^(sh|sz)\.\d{6}$')
MAX_CODES = 50
FIELDS = 'code,code_name,ipoDate,outDate,type,status'


class ScriptError(Exception):
    pass


def read_params() -> dict:
    try:
        params = json.loads(Path('input.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise ScriptError('缺少 input.json') from None
    except json.JSONDecodeError as error:
        raise ScriptError(f'input.json 不是合法 JSON: {error}') from None
    if not isinstance(params, dict):
        raise ScriptError('input.json 必须是对象')
    return params


def require_codes(value) -> list:
    if not isinstance(value, list) or not value:
        raise ScriptError('codes 必须是非空数组')
    if len(value) > MAX_CODES:
        raise ScriptError(f'codes 最多 {MAX_CODES} 个')
    codes = []
    for item in value:
        if not isinstance(item, str) or not CODE_RE.match(item):
            raise ScriptError('codes 只能是 baostock 规范形态 sh.XXXXXX / sz.XXXXXX')
        digits = item[3:]
        if digits[0] in '48' or digits.startswith('92'):
            raise ScriptError('BaoStock 不支持北交所代码（服务端 10004011）')
        if item in codes:
            raise ScriptError(f'codes 含重复代码: {item}')
        codes.append(item)
    return codes


def to_flag(value, field: str):
    text = str(value).strip()
    if text == '':
        return None
    try:
        return int(text)
    except ValueError:
        raise ScriptError(f'{field} 不是整数: {text!r}') from None


def text_or_null(value):
    text = str(value).strip()
    return text if text != '' else None


def fetch(params: dict):
    import baostock as bs

    codes = require_codes(params.get('codes'))
    login = bs.login()
    if login.error_code != '0':
        raise ScriptError(f'baostock 登录失败: {login.error_code} {login.error_msg}')
    try:
        rows = []
        missing = []
        for code in codes:
            result = bs.query_stock_basic(code=code)
            if result.error_code != '0':
                raise ScriptError(f'baostock 查询失败: {result.error_code} {result.error_msg} (code={code})')
            if list(result.fields) != FIELDS.split(','):
                raise ScriptError(f'baostock 返回字段变化: {result.fields}')
            cells = None
            while result.next():
                if cells is not None:
                    raise ScriptError(f'baostock 对 {code} 返回了多行基本信息')
                cells = result.get_row_data()
            if cells is None:
                missing.append(code)
                continue
            if cells[0] != code:
                raise ScriptError(f'baostock 返回的代码与请求不一致: {cells[0]} != {code}')
            rows.append({
                'code': cells[0],
                'name': cells[1],
                'ipo_date': text_or_null(cells[2]),
                'out_date': text_or_null(cells[3]),
                'type': to_flag(cells[4], 'type'),
                'status': to_flag(cells[5], 'status'),
            })
        if missing:
            raise ScriptError(f'baostock 未返回这些代码的基本信息（未覆盖或查询失败）：{", ".join(missing)}')
    finally:
        bs.logout()
    return rows


def main() -> int:
    try:
        rows = fetch(read_params())
        Path('out.json').write_text(
            json.dumps({'rows': rows}, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8',
        )
        return 0
    except ScriptError as error:
        print(f'{SCRIPT}: {error}', file=sys.stderr)
        return 1
    except BaseException as error:  # noqa: BLE001 - every failure must leave a stderr line and exit non-zero
        print(f'{SCRIPT}: {type(error).__name__}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
