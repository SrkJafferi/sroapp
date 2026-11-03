import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { DecorativeBackground } from './DecorativeBackground';
import { Brand, BrandedSignInButton, CareTagline, PagerDots, RoleOptionCard } from './components';
import { theme as t } from './theme';
export function SplashContent({ scale = 1 }: { scale?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 20 * scale }}>
      <Brand scale={scale} />
      <CareTagline scale={scale} splash />
    </View>
  );
}
export function ClinicSplashScreen() {
  const { width, height } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const scale = Math.min(width / 400, 1.3);
  const opacity = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {
        if (mounted) setReduceMotion(true);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (reduceMotion === null) return;
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : 650,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);
  useEffect(() => {
    if (reduceMotion !== false) return;
    const movement = Animated.timing(drift, { toValue: 1, duration: 2500, useNativeDriver: true });
    movement.start();
    return () => movement.stop();
  }, [drift, reduceMotion]);
  useEffect(() => {
    const timer = setTimeout(() => router.replace('/welcome'), 2600);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          inset: -3,
          transform: [
            { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [2, -2] }) },
          ],
        }}
      >
        <DecorativeBackground />
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue to SRO Clinic welcome"
        onPress={() => router.replace('/welcome')}
        style={{ flex: 1 }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: Math.max(insets.top + 40, height * 0.31),
            alignSelf: 'center',
            opacity,
            transform: [
              { scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
            ],
          }}
        >
          <SplashContent scale={scale} />
        </Animated.View>
        <View
          style={{
            position: 'absolute',
            bottom: Math.max(insets.bottom + 30, height * 0.09),
            alignSelf: 'center',
          }}
        >
          <PagerDots scale={scale} />
        </View>
      </Pressable>
    </View>
  );
}
export function ClinicWelcomeScreen() {
  const { width, height } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const scale = Math.min(width / 400, 1.25);
  const compact = height - insets.top - insets.bottom < 680 * scale;
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <DecorativeBackground welcome />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + (compact ? 31 : 36) * scale,
          paddingBottom: insets.bottom + 35 * scale,
          alignItems: 'center',
        }}
      >
        <View style={{ width: '100%', maxWidth: 500, paddingHorizontal: 28 * scale }}>
          <Brand compact scale={scale} />
          <View
            style={{
              alignItems: 'center',
              marginTop: (compact ? 14 : 27) * scale,
              marginBottom: 16 * scale,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                fontFamily: t.fonts.bold,
                fontSize: 28.5 * scale,
                letterSpacing: -0.9 * scale,
                color: t.colors.ink,
                textAlign: 'center',
                includeFontPadding: false,
              }}
            >
              Welcome to SRO Clinic
            </Text>
            <Text
              style={{
                fontFamily: t.fonts.regular,
                fontSize: 12.6 * scale,
                color: t.colors.muted,
                textAlign: 'center',
                marginTop: 5 * scale,
                includeFontPadding: false,
              }}
            >
              Choose your role to continue connected care.
            </Text>
          </View>
          <View style={{ gap: 10 * scale }}>
            {(['patient', 'doctor', 'admin'] as const).map((role) => (
              <RoleOptionCard
                key={role}
                role={role}
                scale={scale}
                onPress={() => {
                  router.push({ pathname: '/portal', params: { role } });
                }}
              />
            ))}
          </View>
          <View style={{ marginTop: 23 * scale, marginHorizontal: 14 * scale }}>
            <BrandedSignInButton scale={scale} onPress={() => router.push('/portal')} />
          </View>
          <View style={{ marginTop: 23 * scale }}>
            <CareTagline scale={scale} />
          </View>
          <View style={{ marginTop: 28 * scale }}>
            <PagerDots scale={scale} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
