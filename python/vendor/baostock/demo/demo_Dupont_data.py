import baostock as bs
import pandas as pd

# 登陆系统
lg = bs.login()
# 显示登陆返回信息
print('login respond error_code:'+lg.error_code)
print('login respond  error_msg:'+lg.error_msg)

# 查询杜邦指数
dupont_list = []
#返回字段：code证券代码、pubDate公司发布财报的日期、statDate财报统计的季度的最后一天, 比如2017-03-31, 2017-06-30、dupontROE净资产收益率
#        dupontAssetStoEquity权益乘数、dupontAssetTurn总资产周转率、dupontPnitoni归属母公司股东的净利润/净利润、dupontNitogr净利润/营业总收入
#        dupontTaxBurden净利润/利润总额、dupontIntburden利润总额/息税前利润、dupontEbittogr息税前利润/营业总收入
rs_dupont = bs.query_dupont_data(code="sh.600000", year=2024, quarter=2)
while (rs_dupont.error_code == '0') & rs_dupont.next():
    dupont_list.append(rs_dupont.get_row_data())
result_profit = pd.DataFrame(dupont_list, columns=rs_dupont.fields)
# 打印输出
print(result_profit)
# 结果集输出到csv文件
result_profit.to_csv("D:\\dupont_data.csv", encoding="gbk", index=False)

# 登出系统
bs.logout()
