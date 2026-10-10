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
        app.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(script, result -> { value.set(result); latch.countDown(); }));
        assertTrue("WebView脚本响应超时", latch.await(5, TimeUnit.SECONDS)); return value.get();
    }
    private void until(ActivityScenario<MainActivity> app, String expression) throws Exception {
        for (int i=0;i<200;i++) { if ("true".equals(js(app, expression))) return; Thread.sleep(100); }
        fail("离线状态未达到预期: " + js(app, "document.body.innerText"));
    }
    @Test public void nativeSqlitePrecisionTransactionsAndReopen() throws Exception {
        try (ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)) {
            until(app,"document.body.innerText.includes('创建账户')");
            assertEquals("true",js(app,"document.body.innerText.includes('本机SQLite')"));
            js(app,"document.querySelectorAll('nav button')[3].click()");
            until(app,"document.body.innerText.includes('运行离线检查')");
            js(app,"document.querySelector('section button').click()");
            until(app,"document.body.innerText.includes('离线能力检查通过。')");
            assertEquals("6",js(app,"document.querySelectorAll('li').length"));
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

}
