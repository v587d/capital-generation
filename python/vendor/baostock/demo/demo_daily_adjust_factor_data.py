import baostock as bs
import pandas as pd

# 登陆系统
lg = bs.login()
# 显示登陆返回信息
print('login respond error_code:'+lg.error_code)
print('login respond  error_msg:'+lg.error_msg)

# 获取某日复权因子信息
rs_list = []
#返回字段：code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor
rs_factor = bs.query_daily_adjust_factor(date="2024-07-18") #
print('query_daily_adjust_factor respond error_code:'+rs_factor.error_code)
print('query_daily_adjust_factor respond  error_msg:'+rs_factor.error_msg)

while (rs_factor.error_code == '0') & rs_factor.next():
    # 获取一条记录，将记录合并在一起
    rs_list.append(rs_factor.get_row_data())
result = pd.DataFrame(rs_list, columns=rs_factor.fields)
# 打印输出
print(result)

# 结果集输出到csv文件
result.to_csv("D:\\daily_adjust_factor_data.csv", encoding="gbk", index=False)

# 登出系统
bs.logout()
