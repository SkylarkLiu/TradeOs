package com.tradeos.offline.prototype;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OfflineRuntimeTest {
    private String js(ActivityScenario<MainActivity> app, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        String body=script.contains(";")?script:"return ("+script+");";
        String code="(()=>{try{"+body+"}catch(e){return 'JS_ERROR:'+e.message}})()";
        app.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(code, result -> { value.set(result); latch.countDown(); }));
        assertTrue("WebView脚本响应超时", latch.await(5, TimeUnit.SECONDS)); assertFalse("WebView脚本错误: "+value.get(),value.get()!=null && value.get().contains("JS_ERROR:")); return value.get();
    }
    private void until(ActivityScenario<MainActivity> app, String expression) throws Exception {
        for (int i=0;i<200;i++) { if ("true".equals(js(app, expression))) return; Thread.sleep(100); }
        fail("离线状态未达到预期: " + js(app, "document.body.innerText"));
    }
    @Test public void nativeSqlitePrecisionTransactionsAndReopen() throws Exception {
        try (ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            assertEquals("true",js(app,"document.body.innerText.includes('本机SQLite')"));
            js(app,"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='离线检查').click()");
            until(app,"document.body.innerText.includes('运行离线检查')");
            js(app,"document.querySelector('section button').click()");
            until(app,"document.body.innerText.includes('离线能力检查通过。')");
            assertEquals("11",js(app,"document.querySelectorAll('li').length"));
        }
    }
    @Test public void privateBeforeRestoreFileRoundTrip() throws Exception {
        try (ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            js(app,"window.__fileResult='waiting'; window.Capacitor.Plugins.TradeFiles.saveBefore({content:'{\"probe\":true}'}).then(()=>window.Capacitor.Plugins.TradeFiles.readBefore()).then(r=>window.__fileResult=r.content).catch(e=>window.__fileResult='error:'+e.message)");
            until(app,"window.__fileResult !== 'waiting'");
            assertEquals("\"{\\\"probe\\\":true}\"",js(app,"window.__fileResult"));
        }
    }
    @Test public void nativeCashEntrySeedForHostRestartVerification() throws Exception {
        try (ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            String name="原生持久化-"+System.currentTimeMillis();
            js(app,"document.querySelector('input[name=platform]').value='离线验收'; document.querySelector('input[name=name]').value='"+name+"'; document.querySelector('form').requestSubmit()");
            until(app,"document.body.innerText.includes('"+name+"')");
            js(app,"const select=document.querySelector('select[name=accountId]');select.value=[...select.options].find(o=>o.textContent.includes('"+name+"')).value;document.querySelector('input[name=amount]').value='1000.00000001';document.querySelectorAll('form')[1].requestSubmit()");
            until(app,"document.body.innerText.includes('流水与余额已一起保存。')");
            assertEquals("true",js(app,"document.body.innerText.includes('1000.00000001')"));
        }
    }

    @Test public void nativeAssetBuyQuoteAndReopen() throws Exception {
        String token=Long.toString(System.currentTimeMillis());
        try (ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            js(app,"document.querySelector('input[name=platform]').value='原生资产验收';document.querySelector('input[name=name]').value='asset-"+token+"';document.querySelector('form').requestSubmit()");
            until(app,"document.body.innerText.includes('asset-"+token+"')");
            js(app,"const a=document.querySelector('select[name=accountId]');a.value=[...a.options].find(o=>o.textContent.includes('asset-"+token+"')).value;document.querySelector('input[name=amount]').value='1000';document.querySelector('input[name=at]').value='2025-01-01T08:00';document.querySelectorAll('form')[1].requestSubmit()");
            until(app,"document.body.innerText.includes('流水与余额已一起保存。')");
            js(app,"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='资产').click()");
            until(app,"document.body.innerText.includes('创建资产')");
            js(app,"document.querySelector('input[name=code]').value='NATIVE-"+token+"';document.querySelector('input[name=name]').value='虚拟现货';document.querySelector('form').requestSubmit()");
            until(app,"document.body.innerText.includes('资产已保存。')");
            js(app,"const a=document.querySelector('select[name=accountId]');a.value=[...a.options].find(o=>o.textContent.includes('asset-"+token+"')).value;a.dispatchEvent(new Event('change',{bubbles:true}))");
            js(app,"const a=document.querySelector('select[name=assetId]');a.value=[...a.options].find(o=>o.textContent.includes('NATIVE-"+token+"')).value;document.querySelector('input[name=quantity]').value='10';document.querySelector('input[name=price]').value='10';document.querySelector('input[name=fee]').value='1';document.querySelector('input[name=at]').value='2025-01-02T08:00';document.querySelectorAll('form')[1].requestSubmit()");
            until(app,"document.body.innerText.includes('现金、持仓和资产流水已一起保存。')");
            js(app,"const f=document.querySelectorAll('form')[2];const a=f.querySelector('select');a.value=[...a.options].find(o=>o.textContent.includes('NATIVE-"+token+"')).value;f.querySelector('input[name=price]').value='12';f.requestSubmit()");
            until(app,"document.body.innerText.includes('报价已保存，估值已更新。')");
            assertEquals("true",js(app,"[...document.querySelectorAll('td')].some(e=>e.textContent==='120')"));
        }
        try (ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            js(app,"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='资产').click()");
            until(app,"document.body.innerText.includes('NATIVE-"+token+"')");
            assertEquals("true",js(app,"[...document.querySelectorAll('td')].some(e=>e.textContent==='120')"));
            InstrumentationRegistry.getInstrumentation().getUiAutomation().waitForIdle(100,2000);
            android.graphics.Bitmap screenshot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            try(java.io.FileOutputStream output=new java.io.FileOutputStream(new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"asset-native-0.3.0.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}

        }
    }
    @Test public void nativeStrategyAndTradeFills() throws Exception {
        String token=Long.toString(System.currentTimeMillis());
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            js(app,"document.querySelector('input[name=platform]').value='原生交易验收';document.querySelector('input[name=name]').value='trade-"+token+"';document.querySelector('form').requestSubmit()");
            until(app,"document.body.innerText.includes('trade-"+token+"')");
            js(app,"const a=document.querySelector('select[name=accountId]');a.value=[...a.options].find(o=>o.textContent.includes('trade-"+token+"')).value;document.querySelector('input[name=amount]').value='1000';document.querySelector('input[name=at]').value='2025-01-01T08:00';document.querySelectorAll('form')[1].requestSubmit()");
            until(app,"document.body.innerText.includes('流水与余额已一起保存。')");
            js(app,"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='资产').click()");
            until(app,"document.body.innerText.includes('创建资产')");
            js(app,"document.querySelector('input[name=code]').value='TRADE-"+token+"';document.querySelector('input[name=name]').value='交易验收股票';document.querySelector('form').requestSubmit()");
            until(app,"document.body.innerText.includes('资产已保存。')");
            js(app,"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='策略').click()");
            until(app,"document.body.innerText.includes('保存策略草稿')");
            js(app,"const f=document.querySelector('form');f.querySelector('input[name=name]').value='策略-"+token+"';f.querySelector('input[name=market]').value='股票现货';f.querySelector('input[name=timeframe]').value='日线';f.querySelector('input[name=environment]').value='上涨';f.querySelector('textarea').value='突破二十日高点入场，回落到止损价退出，到达目标后止盈，所有成交必须记录。';f.requestSubmit()");
            until(app,"document.body.innerText.includes('策略草稿已保存')");
            js(app,"const section=[...document.querySelectorAll('section')].find(s=>s.textContent.includes('策略-"+token+"'));section.querySelector('details').open=true;[...section.querySelectorAll('button')].find(b=>b.textContent==='发布 v1').click()");
            until(app,"document.body.innerText.includes('策略版本已发布。')");
            js(app,"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='交易').click()");
            until(app,"document.body.innerText.includes('建立交易')");
            js(app,"const f=document.querySelector('form');const a=f.querySelector('select[name=accountId]');a.value=[...a.options].find(o=>o.textContent.includes('trade-"+token+"')).value;const asset=f.querySelector('select[name=assetId]');asset.value=[...asset.options].find(o=>o.textContent.includes('TRADE-"+token+"')).value;const strategy=f.querySelector('select[name=strategyVersionId]');strategy.value=[...strategy.options].find(o=>o.textContent.includes('策略-"+token+"')).value;f.querySelector('input[name=openedAt]').value='2025-01-02T08:00';f.requestSubmit()");
            until(app,"document.body.innerText.includes('交易已建立')");
            js(app,"const a=document.querySelector('select[aria-label=当前交易]');a.value=[...a.options].find(o=>o.textContent.includes('TRADE-"+token+"')).value;a.dispatchEvent(new Event('change',{bubbles:true}))");
            until(app,"document.body.innerText.includes('实际成交价')");
            js(app,"const f=document.querySelector('form[aria-label=成交表单]');f.querySelector('input[name=quantity]').value='2';f.querySelector('input[name=price]').value='10';f.querySelector('input[name=fee]').value='1';f.querySelector('input[name=at]').value='2025-01-02T08:00';f.requestSubmit()");
            until(app,"document.body.innerText.includes('成交与交易、现金、持仓已一起保存。')");
            js(app,"const f=document.querySelector('form[aria-label=成交表单]');f.querySelector('select').value='EXIT';f.querySelector('input[name=quantity]').value='2';f.querySelector('input[name=price]').value='15';f.querySelector('input[name=fee]').value='1';f.querySelector('input[name=at]').value='2025-01-03T08:00';f.requestSubmit()");
            until(app,"document.body.innerText.includes('交易已平仓，成交和持仓事件保留，只读。')");
            assertEquals("true",js(app,"[...document.querySelectorAll('td')].some(e=>e.textContent==='8')"));
            InstrumentationRegistry.getInstrumentation().getUiAutomation().waitForIdle(100,2000);
            android.graphics.Bitmap screenshot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            try(java.io.FileOutputStream output=new java.io.FileOutputStream(new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"trading-native-0.3.0.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);}
        }
    }
}
