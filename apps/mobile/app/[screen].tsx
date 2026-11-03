import { useLocalSearchParams } from 'expo-router';
import { Appointments, DoctorDetail, Doctors, Patients } from '../src/main-screens';
import { AppointmentDetail, Booking, Consultation } from '../src/visit-screens';
import { Records } from '../src/record-screens';
import { AdminScreen, Settings, Notifications, Auth } from '../src/other-screens';
import { Empty, Page } from '../src/ui';
export default function Screen() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  switch (screen) {
    case 'doctors':
      return <Doctors />;
    case 'doctor':
      return <DoctorDetail />;
    case 'patients':
      return <Patients />;
    case 'book':
      return <Booking />;
    case 'appointment':
      return <AppointmentDetail />;
    case 'consultation':
      return <Consultation />;
    case 'approvals':
      return <Appointments approvals />;
    case 'records':
    case 'prescriptions':
    case 'reports':
      return <Records kind={screen} />;
    case 'settings':
      return <Settings />;
    case 'notifications':
      return <Notifications />;
    case 'auth':
      return <Auth />;
    case 'branches':
    case 'departments':
    case 'schedules':
    case 'fees':
    case 'activity':
    case 'form':
      return <AdminScreen section={screen} />;
    default:
      return (
        <Page title="Page unavailable">
          <Empty title="Choose a page from your workspace" />
        </Page>
      );
  }
}
