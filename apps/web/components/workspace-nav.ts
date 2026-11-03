import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  CalendarCheck2,
  ClipboardList,
  FileHeart,
  HeartPulse,
  LayoutDashboard,
  Settings,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { DemoRole } from '@sro/types';

export type NavItem = {
  key: string;
  title: string;
  icon: LucideIcon;
  roles: DemoRole[];
  group?: string;
};
export const workspaceNav: NavItem[] = [
  {
    key: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'doctor', 'patient'],
  },
  {
    key: 'appointments',
    title: 'Appointments',
    icon: CalendarDays,
    roles: ['admin', 'doctor', 'patient'],
  },
  {
    key: 'approvals',
    title: 'Pending approvals',
    icon: CalendarCheck2,
    roles: ['admin', 'doctor'],
  },
  {
    key: 'patients',
    title: 'Patients',
    icon: Users,
    roles: ['admin', 'doctor'],
    group: 'CARE MANAGEMENT',
  },
  { key: 'doctors', title: 'Doctors', icon: Stethoscope, roles: ['admin', 'patient'] },
  { key: 'branches', title: 'Clinic branches', icon: Building2, roles: ['admin'] },
  { key: 'specializations', title: 'Departments', icon: HeartPulse, roles: ['admin', 'patient'] },
  { key: 'schedules', title: 'Schedules & leave', icon: ClipboardList, roles: ['admin', 'doctor'] },
  {
    key: 'records',
    title: 'Medical records',
    icon: FileHeart,
    roles: ['admin', 'doctor', 'patient'],
    group: 'WORKSPACE',
  },
  {
    key: 'prescriptions',
    title: 'Prescriptions',
    icon: ClipboardList,
    roles: ['doctor', 'patient'],
  },
  { key: 'reports', title: 'Medical reports', icon: FileHeart, roles: ['doctor', 'patient'] },
  { key: 'fees', title: 'Consultation fees', icon: Wallet, roles: ['admin'] },
  { key: 'activity', title: 'Activity & audit', icon: Activity, roles: ['admin'] },
  {
    key: 'notifications',
    title: 'Notifications',
    icon: Bell,
    roles: ['admin', 'doctor', 'patient'],
  },
  {
    key: 'settings',
    title: 'Settings & profile',
    icon: Settings,
    roles: ['admin', 'doctor', 'patient'],
  },
];
export function workspaceHref(role: DemoRole, key: string) {
  return `/${role}${key === 'dashboard' ? '' : `/${key}`}`;
}
