"""Fixed data script: PBC social-financing flow (社会融资规模增量), monthly, unit 亿元.

Protocol (see python/worker.py `run`):
  - read ./input.json  {} or {"months": N}   (N = 1..120, months back from the latest published month)
  - write ./out.json   {"rows": [...]} by month ascending
  - on failure print one line to stderr and exit non-zero (no partial out.json)

Chain: index page -> year page -> "社会融资规模" topic page -> first attachment (.xlsx) -> openpyxl.
openpyxl comes from python/vendor; the base pack has no xlrd, so the `.xls` years (2021 and older)
are a documented boundary, not a crash. Unpublished months are dropped entirely (they carry no
total). Excel eats the trailing zero of October, so a one-digit fractional part is always month x0.
"""
import io
import json
import math
import re
import ssl
import sys
import urllib.request
from pathlib import Path

SCRIPT = 'pbc_social_financing'
BASE = 'https://www.pbc.gov.cn'
INDEX_URL = f'{BASE}/diaochatongjisi/116219/116319/index.html'
UA = {'User-Agent': 'Mozilla/5.0'}
MONTH_RE = re.compile(r'^(\d{4})\.(\d{1,2})$')
YEAR_LINK_RE = re.compile(r"""href=["']([^"']+)["'][^>]*>\s*(\d{4})年统计数据\s*</a>""")
TOPIC_LINK_RE = re.compile(r"""href=["']([^"']+)["'][^>]*>\s*(社会融资规模)\s*</a>""")
BOOK_LINK_RE = re.compile(r"""href=["']([^"']+\.xlsx?)["']""")
# 2021 and earlier attach binary .xls (OLE2), which openpyxl cannot read; 2022 is the first .xlsx year
# (measured 2026-11-22: 2021 = .xls, 2022..2026 = .xlsx).
FIRST_XLSX_YEAR = 2022
COLUMNS = [
    'month',
    'afre_total',            # 社会融资规模增量
    'rmb_loans',             # 人民币贷款
    'fx_loans',              # 外币贷款（折合人民币）
    'entrusted_loans',       # 委托贷款
    'trust_loans',           # 信托贷款
    'undiscounted_bankers_acceptance',  # 未贴现银行承兑汇票
    'corporate_bonds',       # 企业债券
    'government_bonds',      # 政府债券
    'equity_financing',      # 非金融企业境内股票融资
    'abs_by_depository',     # 存款类金融机构资产支持证券
    'loans_written_off',     # 贷款核销
]
MAX_MONTHS = 120


class ScriptError(Exception):
    pass


def read_params() -> dict:
    path = Path('input.json')
    if not path.is_file():
        return {}
    try:
        params = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        raise ScriptError(f'input.json 不是合法 JSON: {error}') from None
    if not isinstance(params, dict):
        raise ScriptError('input.json 必须是对象')
    return params


def require_months(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ScriptError('months 必须是整数')
    if not 1 <= value <= MAX_MONTHS:
        raise ScriptError(f'months 必须在 1..{MAX_MONTHS}')
    return value


def http_get(url: str, timeout: int = 40) -> bytes:
    request = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            return response.read()
    except Exception as error:  # noqa: BLE001 - one network failure must name the step, not dump a traceback
        raise ScriptError(f'请求失败 {url}: {type(error).__name__}: {error}') from None


def page_text(url: str) -> str:
    body = http_get(url)
    for encoding in ('utf-8', 'gb18030'):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode('utf-8', 'replace')


def absolute(href: str) -> str:
    return href if href.startswith('http') else BASE + href


def index_years() -> dict:
    html = page_text(INDEX_URL)
    years = index_years_from(html)
    if not years:
        raise ScriptError('人民银行索引页未找到「XXXX年统计数据」链接，页面结构可能已变更')
    return years


def index_years_from(html: str) -> dict:
    table = {}
    for href, year in YEAR_LINK_RE.findall(html):
        table.setdefault(int(year), href)
    return table


def year_topic_url(year: int, year_href: str) -> str:
    html = page_text(absolute(year_href))
    topics = TOPIC_LINK_RE.findall(html)
    if not topics:
        raise ScriptError(f'人民银行 {year} 年页未找到「社会融资规模」专题链接')
    return absolute(topics[0][0])


def flow_book_url(topic_url: str, year: int) -> str:
    html = page_text(topic_url)
    books = BOOK_LINK_RE.findall(html)
    xlsx = [href for href in books if href.endswith('.xlsx')]
    if xlsx:
        return absolute(xlsx[0])
    if books:
        raise ScriptError(
            f'人民银行 {year} 年社融专题页只提供 .xls（旧版二进制），openpyxl 无法读取；'
            f'本通道可用历史从 {FIRST_XLSX_YEAR}-01 起'
        )
    raise ScriptError(f'人民银行 {year} 年社融专题页未找到 xls/xlsx 附件')


def month_label(value):
    text = str(value).strip()
    match = MONTH_RE.match(text)
    if not match:
        return None
    year = int(match.group(1))
    fraction = match.group(2)
    # Excel stores 2026.10 as the float 2026.1; January is always written ".01", so a single
    # fractional digit can only be a trailing zero that got eaten (October/November/December).
    month = int(fraction + '0') if len(fraction) == 1 else int(fraction)
    if not 1 <= month <= 12:
        raise ScriptError(f'社融表月份无法解析: {text!r}')
    return f'{year:04d}-{month:02d}'


def to_number(cell):
    if cell is None:
        return None
    if isinstance(cell, bool):
        raise ScriptError('社融表出现布尔值')
    if isinstance(cell, (int, float)):
        if not math.isfinite(float(cell)):
            raise ScriptError('社融表出现非有限数字')
        return int(cell) if float(cell).is_integer() else float(cell)
    text = str(cell).strip()
    if text == '':
        return None
    try:
        number = float(text)
    except ValueError:
        raise ScriptError(f'社融表数值列不是数字: {text!r}') from None
    if not math.isfinite(number):
        raise ScriptError(f'社融表数值列不是有限数字: {text!r}')
    return int(number) if number.is_integer() else number


def parse_workbook(content: bytes, year: int) -> list:
    import openpyxl

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as error:  # noqa: BLE001
        raise ScriptError(f'{year} 年社融附件不是可读的 .xlsx: {type(error).__name__}: {error}') from None
    try:
        sheet = workbook[workbook.sheetnames[0]]
        values = [list(row) for row in sheet.iter_rows(values_only=True)]
    finally:
        workbook.close()

    header = None
    for index, row in enumerate(values):
        if str(row[0]).strip() == '月份':
            header = index
            break
    if header is None:
        raise ScriptError(
            f'{year} 年社融表没有独立的「月份」表头单元格；2020 及更早为旧版式，本通道不支持'
        )
    head = values[header]
    if len(head) < len(COLUMNS) or '社会融资规模增量' not in str(head[1]):
        raise ScriptError(f'{year} 年社融表头与「社会融资规模增量」不符，页面结构可能已变更')

    rows = []
    for row in values[header + 1:]:
        if not row:
            continue
        label = month_label(row[0])
        if label is None or not label.startswith(f'{year}-'):
            continue
        cells = row[1:len(COLUMNS)]
        if len(cells) < len(COLUMNS) - 1:
            raise ScriptError(f'{year} 年社融表 {label} 行列数不足: {len(row)}')
        values_by_column = {name: to_number(cell) for name, cell in zip(COLUMNS[1:], cells)}
        if values_by_column['afre_total'] is None:
            continue  # 未发布月份整行丢弃
        rows.append({'month': label, **values_by_column})
    return rows


def fetch_year(year: int, year_href: str) -> list:
    topic_url = year_topic_url(year, year_href)
    book_url = flow_book_url(topic_url, year)
    content = http_get(book_url, timeout=60)
    if not content.startswith(b'PK'):
        raise ScriptError(f'{year} 年社融附件不是 .xlsx（缺少 ZIP 头），无法用 openpyxl 读取')
    rows = parse_workbook(content, year)
    rows.sort(key=lambda row: row['month'])
    return rows


def month_index(label: str) -> int:
    year, month = label.split('-')
    return int(year) * 12 + int(month)


def select(rows: list, latest: str, months) -> list:
    ordered = sorted(rows, key=lambda row: row['month'])
    if months is None:
        return ordered
    end = month_index(latest)
    start = end - months + 1
    return [row for row in ordered if start <= month_index(row['month']) <= end]


def fetch(params: dict) -> list:
    months = require_months(params.get('months'))
    years = index_years()
    order = sorted(years, reverse=True)
    collected = {}
    if months is None:
        # Upstream default = the newest year that has published rows (early January can leave the
        # newest year page without data, so fall back one year before failing).
        for year in order:
            if year < FIRST_XLSX_YEAR:
                break
            rows = fetch_year(year, years[year])
            if rows:
                collected.update({row['month']: row for row in rows})
                break
        if not collected:
            raise ScriptError(f'没有可用的社融数据（{FIRST_XLSX_YEAR} 年起的 .xlsx 均无已发布月份）')
        return select(list(collected.values()), max(collected), None)

    for year in order:
        if year < FIRST_XLSX_YEAR:
            break
        rows = fetch_year(year, years[year])
        collected.update({row['month']: row for row in rows})
        if collected:
            latest = max(collected)
            start = month_index(latest) - months + 1
            if month_index(min(collected)) <= start:
                break
    if not collected:
        raise ScriptError(f'没有可用的社融数据（{FIRST_XLSX_YEAR} 年起的 .xlsx 均无已发布月份）')
    return select(list(collected.values()), max(collected), months)


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
