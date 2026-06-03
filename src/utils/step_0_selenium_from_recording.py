# 本脚本由录制数据经语义归并（merge）与 Phase1 结构化步骤生成，定位均为 XPath，调用 Driver4。
# designed by @yuzechao

from driver4 import Driver4

CHROMEDRIVER_PATH = "F:\\chrome144\\chromedriver.exe"

def main():
    d = Driver4()
    d.open("https://tpt.supcon.com/tpt-app/#/home/chat/main?TptSaasUserTenantryId=ATL43NW8", CHROMEDRIVER_PATH)

    # ---------- 结构化步骤对应操作（enriched） ----------

    # semantic_step_index=1 status=normal
    # 在用户名输入框中输入手机号 15700078644
    # --- enriched action index=1 type=input ---
    d.set_value("//*[@id='username']", "15700078644")

    # semantic_step_index=2 status=normal
    # 在密码输入框中输入密码（已脱敏）
    # --- enriched action index=2 type=input ---
    d.set_value("//*[@id='pass64']", "arthur")

    # semantic_step_index=3 status=normal
    # 点击同意协议复选框
    # --- enriched action index=3 type=click ---
    d.click("//*[@id='agree']")

    # semantic_step_index=4 status=normal
    # 点击“立即登录”按钮完成登录
    # --- enriched action index=4 type=click ---
    d.click("//button[normalize-space(.)='立即登录']")

    # semantic_step_index=5 status=normal
    # 点击用户头像或菜单触发器，展开用户菜单
    # --- enriched action index=5 type=click ---
    # d.click("//*[@id='root']/div/div/div/div[2]/div/div[1]/div[1]/div[2]/div[4]/div/div[1]/div[1]/img[2]/..")
    d.click("//*[@class='logo']")

    # semantic_step_index=6 status=normal
    # 点击用户菜单中的“偏好设置”选项
    # --- enriched action index=6 type=click ---
    d.click("//*[@id=':r3:']/div/div/div[2]/div[1]")

    # semantic_step_index=7 status=normal
    # 点击偏好设置中的“详细模式”选项
    # --- enriched action index=7 type=click ---
    d.click("/html/body/div[3]/div[1]/div[2]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[2]/div[2]/div[1]/div[3]/div[1]/div[1]/div[1]")

    # semantic_step_index=8 status=normal
    # 点击切换开关以启用详细模式
    # --- enriched action index=8 type=click ---
    d.click("/html/body/div[3]/div[1]/div[2]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[4]/div[2]/div[1]/div[1]/div[3]/button[1]/span[1]")

    # semantic_step_index=9 status=normal
    # 点击切换开关以启用详细模式
    # --- enriched action index=9 type=click ---
    d.click("/html/body/div[3]/div[1]/div[2]/div[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[5]/div[2]/div[1]/button[1]/span[1]")

    # semantic_step_index=10 status=normal
    # 点击偏好设置面板中的“恢复默认设置”按钮
    # --- enriched action index=10 type=click ---
    d.click("/html/body/div[3]/div[1]/div[2]/div[1]/div[1]/div[1]/button[1]/span[1]/span[1]")


    d.quit()


if __name__ == '__main__':
    main()
