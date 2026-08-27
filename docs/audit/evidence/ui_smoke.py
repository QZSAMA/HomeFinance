import json
from pathlib import Path

from playwright.sync_api import Route, sync_playwright


OUTPUT_DIR = Path(__file__).resolve().parent
BASE_URL = "http://127.0.0.1:5173"


def json_response(route: Route, payload: object, status: int = 200) -> None:
    route.fulfill(
        status=status,
        content_type="application/json; charset=utf-8",
        body=json.dumps(payload, ensure_ascii=False),
    )


def main() -> None:
    requests: list[dict[str, object]] = []
    console_errors: list[str] = []
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def handle_api(route: Route) -> None:
            request = route.request
            authorization = request.headers.get("authorization")
            requests.append(
                {
                    "method": request.method,
                    "url": request.url,
                    "authorization": authorization,
                }
            )
            path = request.url.split("/api/", 1)[-1]

            if path == "auth/login" and request.method == "POST":
                json_response(
                    route,
                    {
                        "user": {"id": "user-1", "email": "audit@example.com", "name": "审查用户"},
                        "token": "audit-token",
                    },
                )
                return

            if authorization != "Bearer audit-token":
                json_response(route, {"error": "未授权访问"}, 401)
                return

            if path == "families":
                json_response(
                    route,
                    [
                        {
                            "id": "family-1",
                            "name": "审查家庭",
                            "description": "UI smoke fixture",
                            "createdAt": "2026-08-27T00:00:00.000Z",
                            "updatedAt": "2026-08-27T00:00:00.000Z",
                            "members": [],
                        }
                    ],
                )
                return

            if path.endswith("/reports/summary"):
                json_response(
                    route,
                    {
                        "balanceSheet": {"totalAssets": 100000, "totalLiabilities": 20000, "netWorth": 80000},
                        "incomeStatement": {
                            "thisMonthIncome": 12000,
                            "lastMonthIncome": 10000,
                            "thisMonthExpense": 5000,
                            "lastMonthExpense": 4500,
                            "incomeChange": 20,
                            "expenseChange": 11.11,
                            "netIncome": 7000,
                        },
                        "investmentAllocation": [
                            {"category": "CASH", "value": 100000, "percentage": 100}
                        ],
                        "recentTransactions": {"incomes": [], "expenses": []},
                    },
                )
                return

            if path.endswith("/reports/balance-sheet"):
                json_response(
                    route,
                    {
                        "totalAssets": 100000,
                        "totalLiabilities": 20000,
                        "netWorth": 80000,
                        "assets": {"CASH": 100000},
                        "liabilities": {"MORTGAGE": 20000},
                        "assetList": [],
                        "liabilityList": [],
                    },
                )
                return

            if path.endswith("/reports/income-statement"):
                json_response(
                    route,
                    {
                        "totalIncome": 12000,
                        "totalExpense": 5000,
                        "netIncome": 7000,
                        "incomeByCategory": {"工资": 12000},
                        "expenseByCategory": {"餐饮": 5000},
                        "startDate": None,
                        "endDate": None,
                    },
                )
                return

            if path.endswith("/reports/cash-flow"):
                json_response(
                    route,
                    {
                        "operating": {"income": 12000, "expense": 5000, "net": 7000},
                        "investing": {"income": 0, "expense": 0, "net": 0},
                        "financing": {"income": 0, "expense": 0, "net": 0},
                        "other": {"income": 0, "expense": 0},
                        "netCashFlow": 7000,
                        "startDate": None,
                        "endDate": None,
                    },
                )
                return

            json_response(route, {})

        page.route("**/api/**", handle_api)

        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        unauthenticated_redirect = page.url.endswith("/login")

        login_controls = page.locator("input, select, textarea").evaluate_all(
            """els => els.map(el => ({
                tag: el.tagName,
                id: el.id,
                name: el.getAttribute('name'),
                autocomplete: el.getAttribute('autocomplete'),
                labelled: !!(el.getAttribute('aria-label') ||
                    (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
                    el.closest('label'))
            }))"""
        )
        page.screenshot(path=str(OUTPUT_DIR / "login-desktop.png"), full_page=True)

        page.get_by_label("邮箱").fill("audit@example.com")
        page.get_by_label("密码").fill("audit-password")
        page.get_by_role("button", name="登录").click()
        page.wait_for_url(f"{BASE_URL}/")
        page.get_by_role("heading", name="财务概览").wait_for()

        page.goto(f"{BASE_URL}/reports", wait_until="networkidle")
        page.get_by_role("heading", name="财务报表").wait_for()
        page.screenshot(path=str(OUTPUT_DIR / "reports-desktop.png"), full_page=True)

        report_controls = page.locator("input, select, textarea").evaluate_all(
            """els => els.map(el => ({
                tag: el.tagName,
                id: el.id,
                name: el.getAttribute('name'),
                autocomplete: el.getAttribute('autocomplete'),
                labelled: !!(el.getAttribute('aria-label') ||
                    (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
                    el.closest('label'))
            }))"""
        )
        missing_icon_labels = page.locator("button").evaluate_all(
            """els => els.filter(el => !el.textContent.trim() &&
                !el.getAttribute('aria-label') && !el.getAttribute('title')).length"""
        )
        skip_links = page.locator('a[href="#main"], a[href="#content"]').count()

        income_requests = [
            request
            for request in requests
            if "/reports/income-statement" in str(request["url"])
        ]
        result = {
            "unauthenticated_root_redirects_to_login": unauthenticated_redirect,
            "login_controls": login_controls,
            "report_unlabelled_controls": [item for item in report_controls if not item["labelled"]],
            "icon_buttons_without_accessible_name": missing_icon_labels,
            "skip_links": skip_links,
            "income_statement_requests": income_requests,
            "income_statement_has_unauthorized_request": any(
                request["authorization"] is None for request in income_requests
            ),
            "console_errors": console_errors,
            "page_errors": page_errors,
        }
        (OUTPUT_DIR / "ui-smoke-result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
