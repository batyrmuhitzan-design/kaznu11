"""
Scraper module for KazNU Helper App
用于从 univer.kaznu.kz 抓取课表、成绩等信息
"""

import requests
from bs4 import BeautifulSoup
from typing import Optional, Dict, List, Any


class KazNUScraper:
    """
    KazNU 教务系统爬虫类
    用于模拟登录和抓取学生数据
    """
    
    BASE_URL = "https://univer.kaznu.kz"
    
    def __init__(self):
        self.session = requests.Session()
        self.logged_in = False
    
    def login(self, username: str, password: str) -> bool:
        """
        模拟登录 univer.kaznu.kz
        
        Args:
            username: 学号/用户名
            password: 密码
            
        Returns:
            登录是否成功
        """
        # TODO: 实现实际的登录逻辑
        # 1. 访问登录页面获取 CSRF token
        # 2. 提交登录表单
        # 3. 验证登录状态
        
        login_url = f"{self.BASE_URL}/login"
        
        try:
            # 获取登录页面
            response = self.session.get(login_url)
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # TODO: 提取 CSRF token（根据实际页面结构调整）
            # csrf_token = soup.find('input', {'name': 'csrf_token'})['value']
            
            # 提交登录表单
            payload = {
                'username': username,
                'password': password,
                # 'csrf_token': csrf_token
            }
            
            login_response = self.session.post(login_url, data=payload)
            
            # 验证登录是否成功
            # TODO: 根据实际响应判断登录状态
            self.logged_in = True  # 临时设置为 True
            return self.logged_in
            
        except Exception as e:
            print(f"登录失败: {e}")
            return False
    
    def get_schedule(self, semester: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        获取课表信息
        
        Args:
            semester: 学期，如 "2024-2025-1"，默认当前学期
            
        Returns:
            课程列表
        """
        if not self.logged_in:
            print("请先登录")
            return []
        
        # TODO: 实现实际课表抓取逻辑
        schedule_url = f"{self.BASE_URL}/schedule"
        
        try:
            response = self.session.get(schedule_url)
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # TODO: 解析课表 HTML（根据实际页面结构）
            courses = []
            # courses = parse_schedule_html(soup)
            
            return courses
            
        except Exception as e:
            print(f"获取课表失败: {e}")
            return []
    
    def get_grades(self, semester: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        获取成绩信息
        
        Args:
            semester: 学期，如 "2024-2025-1"，默认当前学期
            
        Returns:
            成绩列表
        """
        if not self.logged_in:
            print("请先登录")
            return []
        
        # TODO: 实现实际成绩抓取逻辑
        grades_url = f"{self.BASE_URL}/grades"
        
        try:
            response = self.session.get(grades_url)
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # TODO: 解析成绩 HTML（根据实际页面结构）
            grades = []
            # grades = parse_grades_html(soup)
            
            return grades
            
        except Exception as e:
            print(f"获取成绩失败: {e}")
            return []
    
    def logout(self) -> None:
        """登出并清除 session"""
        logout_url = f"{self.BASE_URL}/logout"
        try:
            self.session.get(logout_url)
        except:
            pass
        finally:
            self.session.close()
            self.logged_in = False


# 辅助函数
def parse_schedule_html(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    """
    解析课表 HTML
    TODO: 根据实际页面结构实现
    """
    courses = []
    # 示例解析逻辑
    # rows = soup.find_all('tr', class_='course-row')
    # for row in rows:
    #     course = {
    #         'name': row.find('td', class_='course-name').text.strip(),
    #         'code': row.find('td', class_='course-code').text.strip(),
    #         ...
    #     }
    #     courses.append(course)
    return courses


def parse_grades_html(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    """
    解析成绩 HTML
    TODO: 根据实际页面结构实现
    """
    grades = []
    # 示例解析逻辑
    return grades


# 测试代码
if __name__ == "__main__":
    scraper = KazNUScraper()
    
    # 测试登录（使用测试账号）
    # success = scraper.login("test_user", "test_pass")
    # print(f"登录结果: {success}")
    
    # 获取课表
    # schedule = scraper.get_schedule()
    # print(f"课表: {schedule}")
    
    # 登出
    # scraper.logout()
    
    print("Scraper 模块测试完成")
