import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import {
  approvedWebAppOrigin,
  allowedWebAppNavigation,
  webAppLoginUrl,
} from '../src/webapp-policy';
import { theme as t } from '../src/onboarding/theme';

export default function Portal() {
  const { role, destination } = useLocalSearchParams<{ role?: string; destination?: string }>();
  const origin = approvedWebAppOrigin();
  const view = useRef<WebView<unknown>>(null);
  const canGoBack = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const s = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        view.current?.goBack();
        return true;
      }
      router.replace('/welcome');
      return true;
    });
    return () => s.remove();
  }, []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      {!origin || failed ? (
        <View style={{ flex: 1, padding: 28, justifyContent: 'center', gap: 20 }}>
          <Text
            accessibilityRole="header"
            style={{ fontFamily: t.fonts.bold, fontSize: 24, color: t.colors.ink }}
          >
            Clinic sign-in is unavailable
          </Text>
          <Text
            style={{
              fontFamily: t.fonts.regular,
              color: t.colors.muted,
              fontSize: 16,
              lineHeight: 25,
            }}
          >
            {origin
              ? 'Unable to securely connect to app.sropk.org. Please try again once the clinic WebApp is available.'
              : 'The clinic WebApp origin is not approved. Contact the clinic administrator.'}
          </Text>
          {origin && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              <Text style={{ fontSize: 17, color: t.colors.ink }}>Try again</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={() => router.replace('/welcome')}>
            <Text style={{ fontSize: 17, color: t.colors.ink }}>Back to welcome</Text>
          </Pressable>
        </View>
      ) : (
        <WebView<unknown>
          key={attempt}
          ref={view}
          source={{ uri: webAppLoginUrl(origin, role, destination) }}
          // Route every navigation through our strict predicate. A narrower
          // originWhitelist can cause rejected links to open in an external app.
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) => allowedWebAppNavigation(request.url, origin)}
          onNavigationStateChange={(state) => {
            canGoBack.current = state.canGoBack;
          }}
          onError={() => setFailed(true)}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400) setFailed(true);
          }}
          startInLoadingState
          renderLoading={() => (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: t.colors.canvas,
              }}
            >
              <ActivityIndicator
                color={t.colors.ink}
                accessibilityLabel="Connecting securely to SRO Clinic"
              />
            </View>
          )}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          incognito={false}
          cacheEnabled={false}
          mixedContentMode="never"
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows
          onOpenWindow={() => {}}
          webviewDebuggingEnabled={false}
          geolocationEnabled={false}
          mediaPlaybackRequiresUserAction
          allowsBackForwardNavigationGestures
        />
      )}
    </SafeAreaView>
  );
}
