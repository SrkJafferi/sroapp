import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Modal, Pressable, Text, View } from 'react-native';
import { clinic } from '@sro/data-access';
import { getActor } from '@sro/clinic-core';
import type { ClinicState, DemoRole, UserProfile } from '@sro/types';
type Context = {
  state: ClinicState;
  role: DemoRole;
  actor: UserProfile;
  setRole: (role: DemoRole) => void;
  branchId: string;
  setBranch: (id: string) => void;
  act: (fn: () => unknown, message?: string) => boolean;
};
const Context = createContext<Context | null>(null);
export function Provider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(clinic.subscribe, clinic.getSnapshot, clinic.getSnapshot);
  const [role, setRole] = useState<DemoRole>('patient');
  const [branchId, setBranch] = useState('b1');
  const [message, setMessage] = useState('');
  const act = (fn: () => unknown, success = 'Demo updated. Changes stay in this session.') => {
    try {
      fn();
      setMessage(success);
      AccessibilityInfo.announceForAccessibility(success);
      return true;
    } catch (e) {
      const text =
        e instanceof Error && !e.message.startsWith('[')
          ? e.message
          : 'Please complete the required fields correctly.';
      setMessage(text);
      AccessibilityInfo.announceForAccessibility(text);
      return false;
    }
  };
  return (
    <Context.Provider
      value={{ state, role, actor: getActor(state, role), setRole, branchId, setBranch, act }}
    >
      {children}
      <Modal
        visible={!!message}
        transparent
        animationType="fade"
        onRequestClose={() => setMessage('')}
      >
        <View
          style={{ flex: 1, backgroundColor: '#17122f66', justifyContent: 'center', padding: 25 }}
        >
          <View
            style={{ backgroundColor: '#fff', padding: 25, borderRadius: 12 }}
            accessibilityViewIsModal
          >
            <Text
              accessibilityRole="header"
              style={{ fontSize: 18, fontWeight: '600', color: '#372575' }}
            >
              SRO Clinic demo
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                lineHeight: 23,
                marginVertical: 20,
                color: '#72758a',
              }}
            >
              {message}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setMessage('')}
              style={{
                backgroundColor: '#372575',
                padding: 14,
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontFamily: 'Inter_400Regular', color: '#fff', fontWeight: '600' }}>
                Got it
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Context.Provider>
  );
}
export function useClinic() {
  const context = useContext(Context);
  if (!context) throw new Error('Provider required');
  return context;
}
