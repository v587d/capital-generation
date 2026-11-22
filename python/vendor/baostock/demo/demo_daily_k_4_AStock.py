import baostock as bs
import pandas as pd

#### 登陆系统 ####
lg = bs.login()
# 显示登陆返回信息
print('login respond error_code:'+lg.error_code)
print('login respond  error_msg:'+lg.error_msg)

#### 获取某日所有股票日K线数据 ####
#返回字段：date,code,open,high,low,close,preclose,volume,amount,adjustflag,turn,tradestatus,pctChg,peTTM,pbMRQ,psTTM,pcfNcfTTM,isST
rs = bs.query_daily_history_k_AStock(date='2026-02-04') #
print('query_daily_history_k_AStock respond error_code:'+rs.error_code)
print('query_daily_history_k_AStock respond  error_msg:'+rs.error_msg)

#### 打印结果集 ####
data_list = []
while (rs.error_code == '0') & rs.next():
    # 获取一条记录，将记录合并在一起
    data_list.append(rs.get_row_data())
result = pd.DataFrame(data_list, columns=rs.fields)

#### 结果集输出到csv文件 ####
result.to_csv("D:/daily_history_k_AStock_data.csv", encoding="gbk", index=False)
print(result)

#### 登出系统 ####
bs.logout()