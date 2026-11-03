import '../global.css';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_500Medium_Italic,
} from '@expo-google-fonts/inter';
import { ActivityIndicator, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
export default function Layout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_500Medium_Italic,
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);
  if (!loaded && !error)
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator accessibilityLabel="Loading SRO Clinic" color="#372575" />
      </View>
    );
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#f9f8ff' }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: '#f9f8ff' },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" options={{ animation: 'none' }} />
          <Stack.Screen name="portal" />
          <Stack.Protected guard={false}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="[screen]" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
