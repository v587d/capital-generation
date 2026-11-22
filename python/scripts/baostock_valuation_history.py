"""Fixed data script: BaoStock daily valuation history (PE/PB/PS/PCF, turnover, trade status, ST).

Protocol (see python/worker.py `run`):
  - read ./input.json  {"code": "sh.600519", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}
  - write ./out.json   {"rows": [...]}
  - on failure print one line to stderr and exit non-zero (no partial out.json)

Runs inside the private interpreter; `baostock` comes from python/vendor (no pip).
BaoStock rejects Beijing Stock Exchange codes server-side (10004011), so they are refused here
before logging in. Numeric cells arrive as strings; an empty string means "not available"
(suspended day / no valuation) and becomes JSON null, never 0.
"""
import json
import math
import re
import sys
from pathlib import Path

SCRIPT = 'baostock_valuation_history'
CODE_RE = re.compile(r'^(sh|sz)\.\d{6}$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
FIELDS = 'date,code,close,peTTM,pbMRQ,psTTM,pcfNcfTTM,turn,tradestatus,isST'


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


def require_code(value) -> str:
    if not isinstance(value, str) or not CODE_RE.match(value):
        raise ScriptError('code 必须是 baostock 规范形态 sh.XXXXXX / sz.XXXXXX')
    digits = value[3:]
    if digits[0] in '48' or digits.startswith('92'):
        raise ScriptError('BaoStock 不支持北交所代码（服务端 10004011）')
    return value


def require_date(value, name: str) -> str:
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ScriptError(f'{name} 必须是 YYYY-MM-DD')
    try:
        year, month, day = (int(part) for part in value.split('-'))
    except ValueError:
        raise ScriptError(f'{name} 不是合法日期') from None
    if not (1 <= month <= 12 and 1 <= day <= 31 and 1990 <= year <= 2100):
        raise ScriptError(f'{name} 不是合法日期')
    return value


def to_number(value, field: str):
    text = str(value).strip()
    if text == '':
        return None
    try:
        number = float(text)
    except ValueError:
        raise ScriptError(f'{field} 不是数字: {text!r}') from None
    if not math.isfinite(number):
        raise ScriptError(f'{field} 不是有限数字: {text!r}')
    return number


def to_flag(value, field: str):
    text = str(value).strip()
    if text == '':
        return None
    if text not in ('0', '1'):
        raise ScriptError(f'{field} 取值不是 0/1: {text!r}')
    return int(text)


def fetch(params: dict):
    import baostock as bs  # imported here so a missing vendor package reports one clean line

    code = require_code(params.get('code'))
    start_date = require_date(params.get('start_date'), 'start_date')
    end_date = require_date(params.get('end_date'), 'end_date')
    if start_date > end_date:
        raise ScriptError('start_date 不能晚于 end_date')

    login = bs.login()
    if login.error_code != '0':
        raise ScriptError(f'baostock 登录失败: {login.error_code} {login.error_msg}')
    try:
        result = bs.query_history_k_data_plus(
            code, FIELDS, start_date=start_date, end_date=end_date, frequency='d', adjustflag='3',
        )
        if result.error_code != '0':
            raise ScriptError(f'baostock 查询失败: {result.error_code} {result.error_msg} (code={code})')
        rows = []
        while result.next():
            cells = result.get_row_data()
            if len(cells) != 10:
                raise ScriptError(f'baostock 返回列数变化: {len(cells)}')
            rows.append({
                'date': cells[0],
                'code': cells[1],
                'close': to_number(cells[2], 'close'),
                'pe_ttm': to_number(cells[3], 'peTTM'),
                'pb_mrq': to_number(cells[4], 'pbMRQ'),
                'ps_ttm': to_number(cells[5], 'psTTM'),
                'pcf_ncf_ttm': to_number(cells[6], 'pcfNcfTTM'),
                'turnover_rate_pct': to_number(cells[7], 'turn'),
                'trade_status': to_flag(cells[8], 'tradestatus'),
                'is_st': to_flag(cells[9], 'isST'),
            })
    finally:
        bs.logout()
    rows.sort(key=lambda row: row['date'])
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
