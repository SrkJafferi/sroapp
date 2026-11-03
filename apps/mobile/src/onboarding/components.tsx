import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  HeartPulse,
  Mail,
  Shield,
  Check,
  Stethoscope,
  Users,
} from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import type { DemoRole } from '@sro/types';
import { theme as t } from './theme';
export function Brand({ scale = 1, compact = false }: { scale?: number; compact?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Image
        source={require('../../assets/sro-onboarding-brand.png')}
        accessibilityLabel="Social Responsibility Organization"
        resizeMode="contain"
        style={{ width: (compact ? 164 : 216) * scale, height: (compact ? 59 : 77) * scale }}
      />
      <Text
        style={{
          fontFamily: t.fonts.bold,
          color: t.colors.ink,
          fontSize: (compact ? 35 : 49) * scale,
          letterSpacing: -1.3 * scale,
          marginTop: (compact ? 3 : 18) * scale,
          includeFontPadding: false,
        }}
      >
        SRO Clinic
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 17 * scale,
          marginTop: 2 * scale,
        }}
      >
        <View style={[styles.line, { width: 23 * scale }]} />
        <Text
          style={{
            fontFamily: t.fonts.medium,
            fontSize: (compact ? 12 : 16) * scale,
            color: t.colors.muted,
            includeFontPadding: false,
          }}
        >
          Clinic Management
        </Text>
        <View style={[styles.line, { width: 23 * scale }]} />
      </View>
    </View>
  );
}
export function PagerDots({ scale = 1 }: { scale?: number }) {
  return (
    <View
      accessible={false}
      style={{
        flexDirection: 'row',
        gap: 13 * scale,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 10 * scale,
            height: 10 * scale,
            borderRadius: 9 * scale,
            backgroundColor: i === 1 ? '#8b20e3' : '#cfc0f8',
            ...(i === 1
              ? {
                  shadowColor: '#a325ef',
                  shadowOpacity: 0.85,
                  shadowRadius: 7 * scale,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 7,
                }
              : {}),
          }}
        />
      ))}
    </View>
  );
}
export function CareTagline({ scale = 1, splash = false }: { scale?: number; splash?: boolean }) {
  return (
    <View
      style={{
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9 * scale,
        ...(splash
          ? {
              paddingHorizontal: 28 * scale,
              paddingVertical: 13 * scale,
              borderRadius: 50,
              backgroundColor: '#ffffff80',
              borderWidth: 1,
              borderColor: '#ffffff90',
            }
          : {}),
      }}
    >
      <HeartPulse color={t.colors.green} size={(splash ? 27 : 22) * scale} strokeWidth={1.5} />
      <Text
        style={{
          fontFamily: t.fonts.italic,
          fontSize: (splash ? 14 : 11) * scale,
          color: t.colors.ink,
        }}
      >
        {splash ? 'Connected care. Better health.' : 'Healthcare for a better tomorrow.'}
      </Text>
    </View>
  );
}
const options = {
  patient: {
    title: 'Patient',
    description: 'Book visits and manage your care',
    Icon: Users,
    tint: '#e9e4ff',
  },
  doctor: {
    title: 'Doctor',
    description: 'Your patients, schedule and consultations',
    Icon: Stethoscope,
    tint: '#d5f5e6',
  },
  admin: {
    title: 'Admin',
    description: 'Manage your clinic, staff and approvals',
    Icon: Shield,
    tint: '#fff0dc',
  },
};
export function RoleOptionCard({
  role,
  onPress,
  scale = 1,
}: {
  role: DemoRole;
  onPress: () => void;
  scale?: number;
}) {
  const { title, description, Icon, tint } = options[role];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          minHeight: 75 * scale,
          borderRadius: t.radii.card * scale,
          paddingHorizontal: 16 * scale,
          paddingVertical: 10 * scale,
          gap: 12 * scale,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={{
          width: 52 * scale,
          height: 47 * scale,
          borderRadius: t.radii.icon * scale,
          backgroundColor: tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id="tile" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop stopColor="white" stopOpacity=".55" />
              <Stop offset="1" stopColor="white" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" rx={t.radii.icon * scale} fill="url(#tile)" />
        </Svg>
        <Icon size={27 * scale} strokeWidth={1.5} color={t.colors.ink} />
        {role === 'admin' && (
          <Check
            color={t.colors.green}
            size={14 * scale}
            strokeWidth={2.5}
            style={{ position: 'absolute' }}
          />
        )}
      </View>
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: '#d9cdfb' }} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: t.fonts.bold,
            fontSize: 17 * scale,
            color: t.colors.ink,
            marginBottom: 2 * scale,
            includeFontPadding: false,
            lineHeight: 21 * scale,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: t.fonts.regular,
            fontSize: 11.7 * scale,
            lineHeight: 14 * scale,
            color: '#675c87',
            includeFontPadding: false,
          }}
        >
          {description}
        </Text>
      </View>
      <ArrowRight size={20 * scale} strokeWidth={1.6} color={t.colors.ink} />
    </Pressable>
  );
}
export function BrandedSignInButton({
  onPress,
  scale = 1,
}: {
  onPress: () => void;
  scale?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44 * scale,
        borderRadius: 15 * scale,
        borderWidth: 1.2,
        borderColor: t.colors.border,
        backgroundColor: pressed ? '#e6defb99' : '#ffffff50',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 13 * scale,
        padding: 10 * scale,
      })}
    >
      <Mail color={t.colors.ink} size={22 * scale} strokeWidth={1.7} />
      <View style={{ height: 21 * scale, width: 1, backgroundColor: t.colors.border }} />
      <Text style={{ fontFamily: t.fonts.bold, fontSize: 13 * scale, color: t.colors.ink }}>
        Sign in with email &amp; password
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  line: { height: 2, borderRadius: 2, backgroundColor: '#d9c7ff' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'white',
    backgroundColor: '#ffffffb8',
    ...t.shadow,
  },
});
