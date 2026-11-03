import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import {
  ArrowRight,
  Calendar as CalendarDays,
  Clock,
  Layers,
  LockKeyhole,
  MapPin,
  Stethoscope,
  Building2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { theme as t } from '../onboarding/theme';
import type { PublicBranch } from './data';
import { reliableOpenStatus } from './data';
import Svg, { Path } from 'react-native-svg';
export type Category = 'branches' | 'doctors' | 'departments' | 'book';
export function SelectionFill({ selected, reduced }: { selected: boolean; reduced: boolean }) {
  const value = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(value, {
      toValue: selected ? 1 : 0,
      duration: reduced ? 0 : 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [selected, reduced, value]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: 35, backgroundColor: '#c7f8e5b8', opacity: value },
      ]}
    />
  );
}
export const categories: { key: Category; title: string; Icon: LucideIcon }[] = [
  { key: 'branches', title: 'Branches', Icon: MapPin },
  { key: 'doctors', title: 'Doctors', Icon: Stethoscope },
  { key: 'departments', title: 'Departments', Icon: Layers },
  { key: 'book', title: 'Book appointment', Icon: CalendarDays },
];
export function CategoryCard({
  item,
  selected,
  onPress,
  scale,
}: {
  item: (typeof categories)[number];
  selected: boolean;
  onPress: () => void;
  scale: number;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={item.title.replace('\n', ' ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glass,
        {
          flex: 1,
          minHeight: 92 * scale,
          paddingVertical: 12 * scale,
          paddingHorizontal: 8 * scale,
          borderRadius: 16 * scale,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8 * scale,
          borderColor: selected ? '#a573fa' : '#ffffffaa',
          borderWidth: selected ? 1.2 : 1,
          backgroundColor: selected ? '#e6dcff9c' : '#ffffff75',
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View>
        {item.key === 'departments' ? (
          <Svg width={31 * scale} height={31 * scale} viewBox="0 0 28 28">
            <Path
              d="M3 10 L14 4 L25 10 L14 16 Z"
              fill="#ffffff70"
              stroke={t.colors.ink}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <Path
              d="M3 18 L14 24 L25 18"
              fill="none"
              stroke={t.colors.green}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : (
          <item.Icon color={t.colors.ink} size={31 * scale} strokeWidth={1.6} />
        )}
        {item.key === 'book' && (
          <LockKeyhole
            size={12 * scale}
            color={t.colors.green}
            fill="#d4f9e8"
            style={{ position: 'absolute', right: -3, bottom: -2 }}
          />
        )}
      </View>
      <Text
        style={{
          fontFamily: t.fonts.bold,
          color: t.colors.ink,
          fontSize: 14 * scale,
          lineHeight: 18 * scale,
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {item.title}
      </Text>
      {selected && (
        <View
          style={{
            position: 'absolute',
            bottom: 1,
            height: 4 * scale,
            width: 38 * scale,
            borderRadius: 9,
            backgroundColor: '#a35afa',
          }}
        />
      )}
    </Pressable>
  );
}
export function BranchCard({
  branch,
  onPress,
  scale,
}: {
  branch: PublicBranch;
  onPress: () => void;
  scale: number;
}) {
  const status = reliableOpenStatus(branch);
  return (
    <View
      style={[
        styles.glass,
        {
          minHeight: 59 * scale,
          borderRadius: 12 * scale,
          padding: 6 * scale,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8 * scale,
        },
      ]}
    >
      {branch.imageUrl ? (
        <Image
          accessibilityLabel={branch.name}
          source={{ uri: branch.imageUrl }}
          style={{ width: 90 * scale, height: 48 * scale, borderRadius: 8 * scale }}
        />
      ) : (
        <View
          style={{
            width: 70 * scale,
            height: 48 * scale,
            borderRadius: 8 * scale,
            backgroundColor: '#e8e2f9',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Building2 color={t.colors.muted} size={30 * scale} />
        </View>
      )}
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: '#ded3f9' }} />
      <View style={{ flex: 1, gap: 3 * scale }}>
        <Text style={{ fontFamily: t.fonts.bold, fontSize: 12.5 * scale, color: t.colors.ink }}>
          {branch.name}
        </Text>
        <View style={{ flexDirection: 'row', gap: 3 * scale }}>
          <MapPin size={11 * scale} color={t.colors.ink} />
          <Text
            style={{
              flex: 1,
              fontFamily: t.fonts.regular,
              fontSize: 9.5 * scale,
              color: t.colors.muted,
            }}
          >
            {branch.location}
          </Text>
        </View>
        {branch.hours && (
          <View style={{ flexDirection: 'row', gap: 3 * scale, alignItems: 'center' }}>
            <Clock size={11 * scale} color={t.colors.ink} />
            <Text
              style={{
                fontFamily: t.fonts.regular,
                fontSize: 8.5 * scale,
                color: status === true ? '#007b51' : t.colors.muted,
                flexShrink: 1,
              }}
            >
              {status === undefined ? '' : status ? 'Open now · ' : 'Closed · '}
              {branch.hours}
            </Text>
          </View>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View details for ${branch.name}`}
        onPress={onPress}
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: 25,
          paddingHorizontal: 9 * scale,
          minHeight: 44,
          justifyContent: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 * scale }}>
          <Text style={{ fontFamily: t.fonts.bold, fontSize: 9 * scale, color: t.colors.ink }}>
            View details
          </Text>
          <ArrowRight size={12 * scale} color={t.colors.ink} />
        </View>
      </Pressable>
    </View>
  );
}
export function BookingPrompt({ onPress, scale }: { onPress: () => void; scale: number }) {
  return (
    <View
      style={[
        styles.glass,
        {
          padding: 8 * scale,
          minHeight: 42 * scale,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10 * scale,
          borderColor: t.colors.border,
          borderRadius: 13 * scale,
        },
      ]}
    >
      <View>
        <CalendarDays size={26 * scale} color={t.colors.ink} />
        <LockKeyhole
          color={t.colors.green}
          size={13 * scale}
          style={{ position: 'absolute', right: -4, bottom: -1 }}
        />
      </View>
      <View style={{ height: 27 * scale, width: 1, backgroundColor: t.colors.border }} />
      <View style={{ flex: 1, gap: 2 * scale }}>
        <Text style={{ fontFamily: t.fonts.bold, fontSize: 10 * scale, color: t.colors.ink }}>
          Login required for appointment booking
        </Text>
        <Text style={{ fontFamily: t.fonts.regular, fontSize: 8 * scale, color: t.colors.muted }}>
          Sign in to book, manage, and view your appointments.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={{
          backgroundColor: '#52228d',
          borderRadius: 30,
          paddingHorizontal: 12 * scale,
          minHeight: 26 * scale,
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: t.fonts.medium, color: 'white', fontSize: 10 * scale }}>
          Sign in →
        </Text>
      </Pressable>
    </View>
  );
}
export const styles = StyleSheet.create({
  glass: { backgroundColor: '#ffffffad', borderWidth: 1, borderColor: '#ffffffcc', ...t.shadow },
  body: { fontFamily: t.fonts.regular, color: t.colors.muted },
  title: { fontFamily: t.fonts.bold, color: t.colors.ink },
});
