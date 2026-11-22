# -*- coding:utf-8 -*-
"""
登录登出
@author: baostock.com
@group : baostock.com
@contact: baostock@163.com
"""
import zlib
import baostock.util.socketutil as sock
import baostock.data.resultset as rs
import baostock.common.contants as cons
import baostock.data.messageheader as msgheader
import datetime
import baostock.common.context as conx

# Base62字符集：数字(0-9)、大写字母(A-Z)、小写字母(a-z)，共62个字符
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

def login(user_id='anonymous', password='123456'):
    """登录系统
    :param user_id:用户ID
    :param password:密码
    :param options:可选项，00.5.00版本暂未使用
    :return: ResultData()
    """

    data = rs.ResultData()

    if user_id is None or user_id == "":
        print("用户ID不能为空。")
        data.error_msg = "用户ID不能为空。"
        data.error_code = cons.BSERR_USERNAME_EMPTY
        return data

    setattr(conx, "user_id", user_id)

    if password is None or password == "":
        print("密码不能为空。")
        data.error_msg = "密码不能为空。"
        data.error_code = cons.BSERR_PASSWORD_EMPTY
        return data

    options = '0' # '0'为默认值
    apiKey = '0' # '0'为默认值
    if hasattr(conx, "apiKey"):
        apiKey = getattr(conx, "apiKey")

        if(apiKey != '0'):
            # 长度检查，“校验和”检查,BSERR_APIKey_FORMAT_INCORRECT
            if(valid_API_key(apiKey) == False):
                data.error_msg = "APIKey格式不正确."
                data.error_code = cons.BSERR_APIKey_FORMAT_INCORRECT
                return data
        options = apiKey

    # 组织体信息
    msg_body = "login" + cons.MESSAGE_SPLIT + user_id + cons.MESSAGE_SPLIT + \
        password + cons.MESSAGE_SPLIT + str(options)

    body_length = len(msg_body)

    # 组织头信息
    msg_header = msgheader.to_message_header(
        cons.MESSAGE_TYPE_LOGIN_REQUEST, body_length)
    head_body = msg_header + msg_body

    crc32str = zlib.crc32(bytes(head_body, encoding='utf-8'))

    # 发送并接收消息
    mySocketUtil = sock.SocketUtil()
    # 创建连接
    mySocketUtil.connect(apiKey)

    receive_data = sock.send_msg(
        head_body + cons.MESSAGE_SPLIT + str(crc32str))

    if receive_data is None or receive_data.strip() == "":
        data.error_code = cons.BSERR_RECVSOCK_FAIL
        data.error_msg = "网络接收错误。"
        return data

    msg_header = receive_data[0:cons.MESSAGE_HEADER_LENGTH]
    msg_body = receive_data[cons.MESSAGE_HEADER_LENGTH:-1]

    header_arr = msg_header.split(cons.MESSAGE_SPLIT)
    body_arr = msg_body.split(cons.MESSAGE_SPLIT)

    data.msg_type = header_arr[1]
    data.msg_body_length = header_arr[2]

    data.error_code = body_arr[0]
    data.error_msg = body_arr[1]

    if cons.BSERR_SUCCESS == data.error_code:
        print("login success!")
        data.method = body_arr[2]
        data.user_id = body_arr[3]
    else:
        print("login failed!")

    return data


def valid_API_key(API_key):
    '''
    简单的检验API-KEY的正确性；（长度检查，“校验和”检查）
    BSERR_APIKey_FORMAT_INCORRECT
    return false:apiKey格式不正确
    '''
    # API-KEY是33位字符串，整体设计构造如下：bs-<2位字符串><27位字符串><1位校验和>
    if API_key is None or not isinstance(API_key, str) or API_key == "":
        print("Invalid API_key: empty or not a string")
        return False

    if len(API_key) != 33:
        print("Invalid API_key: length must be 33")
        return False

    if not API_key.startswith("bs-"):
        print("Invalid API_key: prefix must be 'bs-'")
        return False

    role_code = API_key[3:5]
    payload_b62 = API_key[5:32]   # 27 位
    checksum = API_key[32]

    body = role_code + payload_b62 + checksum
    if any(ch not in ALPHABET for ch in body):
        print("Invalid API_key: contains non-Base62 characters")
        return False

    expected_checksum = calculate_checksum(role_code, payload_b62)
    if checksum != expected_checksum:
        print("Invalid API_key: checksum mismatch")
        return False

    return True

def calculate_checksum(role_code: str, payload: str) -> str:
    """
    计算校验和

    校验和规则：
    1. 将3位role密文和28位载荷拼接
    2. 计算所有字符在ALPHABET中的索引值之和
    3. 对62取模得到索引，对应ALPHABET中的字符

    Args:
        role_code: 3位Base62编码的role密文
        payload: 28位Base62编码的载荷

    Returns:
        1位Base62校验和字符
    """
    combined = role_code + payload
    total = sum(ALPHABET.index(ch) for ch in combined)
    index = total % 62
    return ALPHABET[index]


def set_API_key(apiKey=''):
    """
    设置API_key
    """
    if apiKey is not None or apiKey != "":
        setattr(conx, "apiKey", apiKey)

def logout(user_id='anonymous'):
    """登出系统，默认用户ID：anonymous
    :param user_id:用户ID
    :return:ResultData()
    """

    now_time = datetime.datetime.now().strftime('%Y%m%d%H%M%S')

    if hasattr(conx, "user_id"):
        user_id = getattr(conx, "user_id")
        if user_id is None or user_id == "":
            print("you don't login, logout failed!")
            return

    # 组织体信息
    msg_body = "logout" + cons.MESSAGE_SPLIT + \
        user_id + cons.MESSAGE_SPLIT + now_time

    # 组织头信息
    msg_header = msgheader.to_message_header(
        cons.MESSAGE_TYPE_LOGOUT_REQUEST, len(msg_body))

    head_body = msg_header + msg_body

    crc32str = zlib.crc32(bytes(head_body, encoding='utf-8'))

    # 发送并接收消息
    receive_data = sock.send_msg(
        head_body + cons.MESSAGE_SPLIT + str(crc32str))

    data = rs.ResultData()

    if receive_data is None or receive_data.strip() == "":
        data.error_code = cons.BSERR_RECVSOCK_FAIL
        data.error_msg = "网络接收错误。"
        return data

    msg_header = receive_data[0:cons.MESSAGE_HEADER_LENGTH]
    msg_body = receive_data[cons.MESSAGE_HEADER_LENGTH:-1]

    header_arr = msg_header.split(cons.MESSAGE_SPLIT)
    body_arr = msg_body.split(cons.MESSAGE_SPLIT)

    data.msg_type = header_arr[1]
    data.msg_body_length = header_arr[2]

    data.error_code = body_arr[0]
    data.error_msg = body_arr[1]

    if cons.BSERR_SUCCESS == data.error_code:
        print("logout success!")
        data.method = body_arr[2]
        data.user_id = body_arr[3]
    else:
        print("logout failed!")

    if hasattr(conx, "default_socket"):
        if getattr(conx, "default_socket") is not None:
            getattr(conx, "default_socket").close()

    return data


