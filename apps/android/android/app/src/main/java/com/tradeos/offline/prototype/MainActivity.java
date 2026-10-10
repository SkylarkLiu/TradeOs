package com.tradeos.offline.prototype;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TradeFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
