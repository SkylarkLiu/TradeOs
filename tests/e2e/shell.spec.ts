import {test,expect} from '@playwright/test';
test('本地中文工作台可访问并切换主题',async({page})=>{await page.goto('/wealth');await expect(page.getByRole('heading',{name:'总资产',exact:true})).toBeVisible();await page.getByRole('button',{name:'切换主题'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light')});
