import { Tabs } from 'expo-router';
import { CalendarDays, FileHeart, House, LayoutGrid } from 'lucide-react-native';
import { colors } from '@sro/design-tokens';
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: '#8b849b',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#e9eaf2',
          paddingTop: 6,
          minHeight: 65,
        },
        tabBarLabelStyle: { fontSize: 10, paddingBottom: 4 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Appointments',
          tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: 'Records',
          tabBarIcon: ({ color, size }) => <FileHeart color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Workspace',
          tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
