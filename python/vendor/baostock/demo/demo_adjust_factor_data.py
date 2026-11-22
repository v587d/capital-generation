import baostock as bs
import pandas as pd

# 登陆系统
lg = bs.login()
# 显示登陆返回信息
print('login respond error_code:'+lg.error_code)
print('login respond  error_msg:'+lg.error_msg)

# 查询2015至2017年复权因子
rs_list = []
rs_factor = bs.query_adjust_factor(code="sh.600000", start_date="2022-01-01", end_date="2024-12-31")
while (rs_factor.error_code == '0') & rs_factor.next():
    rs_list.append(rs_factor.get_row_data())
result = pd.DataFrame(rs_list, columns=rs_factor.fields)
# 打印输出
print(result)

# 结果集输出到csv文件
result.to_csv("D:\\adjust_factor_data.csv", encoding="gbk", index=False)

# 登出系统
bs.logout()
