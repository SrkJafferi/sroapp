import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Bell, ChevronDown, ChevronRight, Inbox, X } from 'lucide-react-native';
import { colors } from '@sro/design-tokens';
import { statusLabels } from '@sro/clinic-core';
import type { AppointmentStatus } from '@sro/types';
import { useClinic } from './context';
export const go = (screen: string, params: Record<string, string> = {}) =>
  router.push({ pathname: '/[screen]', params: { screen, ...params } });
export function Txt({
  children,
  muted = false,
  bold = false,
  size = 14,
}: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
  size?: number;
}) {
  return (
    <Text
      style={{
        fontFamily: bold ? 'Inter_600SemiBold' : 'Inter_400Regular',
        color: muted ? colors.muted : colors.text,
        fontSize: size,
        lineHeight: size * 1.5,
        fontWeight: bold ? '600' : '400',
      }}
    >
      {children}
    </Text>
  );
}
export function Btn({
  title,
  onPress,
  outline = false,
  disabled = false,
  danger = false,
}: {
  title: string;
  onPress: () => void;
  outline?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: danger ? '#efc9d0' : outline ? '#ded9e9' : colors.brand,
          backgroundColor: danger ? '#fff5f6' : outline ? '#fff' : colors.brand,
          paddingVertical: 12,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          color: danger ? '#bc4049' : outline ? colors.brand : '#fff',
          fontSize: 13,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <View style={s.card}>
      {title && (
        <Text accessibilityRole="header" style={s.cardTitle}>
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}
export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}
export function Avatar({
  initials,
  color = 'purple',
  large = false,
}: {
  initials: string;
  color?: string;
  large?: boolean;
}) {
  const palette: Record<string, [string, string]> = {
    purple: ['#eeebfa', '#7053ac'],
    blue: ['#eaf2fe', '#345e98'],
    green: ['#e6f6ed', '#276b49'],
    rose: ['#fcedf2', '#934765'],
    orange: ['#fff3e2', '#805612'],
    teal: ['#e5f5f3', '#266c68'],
  };
  const c = palette[color] ?? palette.purple;
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: large ? 68 : 42,
        height: large ? 68 : 42,
        borderRadius: large ? 18 : 21,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c[0],
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          color: c[1],
          fontSize: large ? 24 : 13,
          fontWeight: '600',
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
export function Badge({ status }: { status: AppointmentStatus | 'paid' | 'unpaid' | 'waived' }) {
  const green = ['confirmed', 'completed', 'paid'].includes(status);
  const red = [
    'cancelled',
    'rejected',
    'no_show',
    'doctor_unavailable',
    'cancellation_requested',
  ].includes(status);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 5,
        paddingVertical: 5,
        paddingHorizontal: 8,
        backgroundColor: green ? '#e7f5ec' : red ? '#fcecef' : '#f4effa',
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 10,
          fontWeight: '500',
          color: green ? '#276b49' : red ? '#914252' : '#8262a3',
        }}
      >
        {status in statusLabels ? statusLabels[status as AppointmentStatus] : status}
      </Text>
    </View>
  );
}
export function Input({
  label,
  value,
  onChange,
  multiline = false,
  secret = false,
  placeholder,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  secret?: boolean;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt bold size={12}>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor="#aca4b8"
        keyboardType={
          numeric ? 'numeric' : label.toLowerCase().includes('email') ? 'email-address' : 'default'
        }
        autoCapitalize={label.toLowerCase().includes('email') ? 'none' : 'sentences'}
        style={[s.input, multiline && { minHeight: 95, textAlignVertical: 'top' }]}
      />
    </View>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Txt bold size={12}>
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((o) => o.value === value)?.label ?? 'Select'}`}
        onPress={() => setOpen(true)}
        style={[s.input, s.row, { justifyContent: 'space-between' }]}
      >
        <Text style={{ fontFamily: 'Inter_400Regular', color: colors.text, flex: 1 }}>
          {options.find((o) => o.value === value)?.label ?? 'Select an option'}
        </Text>
        <ChevronDown size={16} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#17122f66', justifyContent: 'flex-end' }}>
          <SafeAreaView
            edges={['bottom']}
            style={{
              maxHeight: '75%',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              backgroundColor: 'white',
              padding: 20,
            }}
            accessibilityViewIsModal
          >
            <Row>
              <View style={{ flex: 1 }}>
                <Txt bold size={18}>
                  {label}
                </Txt>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close choices"
                hitSlop={12}
                onPress={() => setOpen(false)}
              >
                <X size={21} color={colors.brand} />
              </Pressable>
            </Row>
            <ScrollView style={{ marginTop: 12 }}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: o.value === value }}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={{
                    paddingVertical: 18,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_400Regular',
                      color: o.value === value ? colors.brand : colors.text,
                      fontWeight: o.value === value ? '600' : '400',
                    }}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}
export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 30, gap: 13 }}>
      <Inbox size={30} color="#b3a3c7" />
      <Txt bold>{title}</Txt>
      {text && (
        <Txt muted size={12}>
          {text}
        </Txt>
      )}
    </View>
  );
}
export function Item({
  title,
  subtitle,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        minHeight: 63,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Txt size={13} bold>
          {title}
        </Txt>
        {subtitle && (
          <Txt muted size={11}>
            {subtitle}
          </Txt>
        )}
      </View>
      <ChevronRight size={17} color="#a395b5" />
    </Pressable>
  );
}
export function Page({
  title,
  subtitle,
  children,
  back = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  back?: boolean;
}) {
  const { state, actor, branchId } = useClinic();
  const unread = state.notifications.filter(
    (n) => n.recipientIds.includes(actor.id) && !n.readBy.includes(actor.id),
  ).length;
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={s.header}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={{ padding: 12, marginLeft: -12 }}
          >
            <ArrowLeft size={21} color={colors.brand} />
          </Pressable>
        ) : (
          <Image
            source={require('../assets/sro-logo.png')}
            accessibilityLabel="Social Responsibility Organization"
            style={{ width: 92, height: 39 }}
            resizeMode="contain"
          />
        )}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              color: colors.brand,
              fontWeight: '600',
              fontSize: 11,
            }}
          >
            {state.branches.find((b) => b.id === branchId)?.name}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              color: colors.muted,
              fontSize: 9,
              marginTop: 3,
            }}
          >
            Connected care
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Notifications, ${unread} unread`}
          onPress={() => go('notifications')}
          style={{ padding: 12 }}
        >
          <Bell size={21} color={colors.brand} />
          {unread > 0 && (
            <View
              style={{
                position: 'absolute',
                top: 9,
                right: 11,
                height: 5,
                width: 5,
                borderRadius: 3,
                backgroundColor: '#8d6ab5',
              }}
            />
          )}
        </Pressable>
      </View>
      <View className="bg-brand px-5 py-2">
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: '#e4d9f4',
            fontSize: 9,
            letterSpacing: 1,
          }}
        >
          PHASE 1 DEMO · FICTIONAL DATA · {actor.role.toUpperCase()}
        </Text>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: 35, gap: 18 }}
        >
          <View style={{ gap: 6 }}>
            <Text
              accessibilityRole="header"
              style={{
                fontSize: 25,
                lineHeight: 32,
                letterSpacing: -0.6,
                fontWeight: '600',
                color: colors.text,
              }}
            >
              {title}
            </Text>
            {subtitle && (
              <Txt muted size={12}>
                {subtitle}
              </Txt>
            )}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 17,
    gap: 14,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  input: {
    fontFamily: 'Inter_400Regular',
    borderWidth: 1,
    borderColor: '#e0dbe8',
    borderRadius: 8,
    backgroundColor: '#fff',
    padding: 13,
    minHeight: 48,
    fontSize: 14,
    color: colors.text,
  },
  header: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 13,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
