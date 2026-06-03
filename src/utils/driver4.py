# encoding: utf-8

import time
import typing as tp
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys


class Driver4(object):
    """

    """
    COMMON_INTERVAL = 1

    def __init__(self):
        self._: webdriver.Chrome

    def open(self, url: str, chromedriver_path: str):
        """

        :param url:
        :param chromedriver_path:
        :return:
        """
        self._ = webdriver.Chrome(
            service=Service(chromedriver_path)
        )
        self._.get(url)
        # 默认最大化
        self._.maximize_window()
        time.sleep(self.COMMON_INTERVAL)
        return self._

    def quit(self):
        self._.quit()

    def find_element(self, identity: str, timeout: float = 3, ) -> WebElement:
        """

        :param identity:
        :param timeout:
        :return:
        """
        element = WebDriverWait(self._, timeout).until(
            expected_conditions.visibility_of_element_located(
                (By.XPATH, identity)
            )
        )
        return element

    def find_elements(self, identity: str, timeout: float = 3, ) -> tp.List[WebElement]:
        """

        :param identity:
        :param timeout:
        :return:
        """
        return self._.find_elements(By.XPATH, identity)

    def is_element_exist(self, identity: str, timeout: float = 3):
        try:
            self.find_element(identity, timeout)
            return True
        # except (NoSuchElementException, TimeoutException):
        #     return False
        except Exception as e:
            # raise e
            return False

    def click(self, identity: str, timeout: float = 3, ):
        """

        :param identity:
        :param timeout:
        :return:
        """
        self.find_element(identity, timeout).click()
        time.sleep(self.COMMON_INTERVAL)

    def set_value(self, identity: str, val: str, timeout: float = 3):
        """

        :param identity:
        :param val:
        :param timeout:
        :return:
        """
        # self.find_element(identity, timeout).send_keys(val)
        # time.sleep(0.5)

        # 如果有内容就先清空
        if self.is_element_exist(identity + '/..//span[contains(@class, "input-clear-icon")]', 1):
            self.click(identity + '/..//span[contains(@class, "input-clear-icon")]')

        input_element = self.find_element(identity, timeout)
        input_element.send_keys(val)
        time.sleep(self.COMMON_INTERVAL)

    def set_value_by_select_all(self, identity: str, val: str, timeout: float = 3):
        """

        """
        input_element = self.find_element(identity, timeout)
        self.double_click(identity)
        input_element.send_keys(val)
        time.sleep(self.COMMON_INTERVAL)

    def set_multiple_value(self, identity: str, val: str, timeout: float = 3):
        """
        在指定的输入框中设置多行值。（还没验证过，因为没用到了）

        :param identity: 输入框的定位符
        :param val: 要输入的值，可以是多行字符串
        :param timeout: 查找元素的超时时间
        :return: None
        """
        input_element = self.find_element(identity, timeout)
        input_element.clear()

        # 将多行字符串分割成行，并逐行输入
        for line in val.splitlines():
            input_element.send_keys(line)
            input_element.send_keys(Keys.ENTER)  # 使用 Enter 键来输入换行符

            time.sleep(self.COMMON_INTERVAL)

        time.sleep(self.COMMON_INTERVAL)

    def double_click(self, identity: str, timeout: float = 3, ):
        """

        :param identity:
        :param timeout:
        :return:
        """
        element = self.find_element(identity, timeout)
        actions = ActionChains(self._)
        actions.double_click(element)
        actions.perform()
        time.sleep(self.COMMON_INTERVAL)

    def right_click(self, identity: str, timeout: float = 3, ):
        """

        :param identity:
        :param timeout:
        :return:
        """
        element = self.find_element(identity, timeout)
        actions = ActionChains(self._)
        actions.context_click(element)
        actions.perform()
        time.sleep(self.COMMON_INTERVAL)

    def click_xy(self, identity: str, x: int, y: int, mode: int = 0, timeout: float = 3):
        """

        :param identity:
        :param x:
        :param y:
        :param mode: 0鼠标左键单击|1鼠标右键单击|2鼠标左键双击
        :param timeout:
        :return:
        """
        element = self.find_element(identity, timeout)
        actions = ActionChains(self._)
        if mode == 0:
            actions.move_to_element_with_offset(element, x, y).click().perform()
        elif mode == 1:
            actions.move_to_element_with_offset(element, x, y).context_click().perform()
        elif mode == 2:
            actions.move_to_element_with_offset(element, x, y).double_click().perform()
        else:
            raise NotImplementedError
        time.sleep(self.COMMON_INTERVAL)

    def switch_to_iframe(self,
                         s=None,
                         to_default_content=False
                         ):
        """
        切换到指定iframe 或切换回默认主iframe
        :param s: 支持对象实例、xpath路径字符串，是iframe的
        :param to_default_content: 是否为切换回默认主iframe
        """
        if to_default_content:
            self._.switch_to.default_content()
        else:
            if type(s) == WebElement:
                elem = s
            else:
                elem = self.find_element(s)
            self._.switch_to.frame(elem)

        time.sleep(self.COMMON_INTERVAL)







