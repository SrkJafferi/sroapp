import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowRight,
  Building2,
  Calendar as CalendarDays,
  Clock,
  Flame,
  Home,
  MapPin,
  Mic,
  Search,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react-native';
import { DecorativeBackground } from '../onboarding/DecorativeBackground';
import { theme as t } from '../onboarding/theme';
import {
  BranchCard,
  BookingPrompt,
  categories,
  CategoryCard,
  SelectionFill,
  styles,
  type Category,
} from './components';
import { loadDiscoveryFeed, reliableOpenStatus, searchDiscovery, type DiscoveryFeed } from './data';
const empty: DiscoveryFeed = { version: 1, branches: [], doctors: [], departments: [] };
export default function DiscoveryHome() {
  const { width } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const s = Math.min(width / 400, 1.3);
  const [category, setCategory] = useState<Category>('branches'),
    [tab, setTab] = useState('Home'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [feed, setFeed] = useState<DiscoveryFeed>(empty),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [detail, setDetail] = useState<{
      title: string;
      body: string;
      links?: { kind: 'branch' | 'doctor' | 'department'; id: string; name: string }[];
    } | null>(null),
    [reduce, setReduce] = useState<boolean | null>(null);
  const fade = useRef(new Animated.Value(1)).current;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [category, tab]);
  const entrance = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (active) setReduce(v);
      })
      .catch(() => {
        if (active) setReduce(true);
      });
    const l = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      l.remove();
    };
  }, []);
  useEffect(() => {
    if (reduce === null) return;
    const entry = Animated.timing(entrance, {
      toValue: 1,
      duration: reduce ? 0 : 450,
      useNativeDriver: true,
    });
    entry.start();
    if (reduce) {
      orbit.setValue(0);
      return () => entry.stop();
    }
    const movement = Animated.timing(orbit, { toValue: 1, duration: 5000, useNativeDriver: true });
    movement.start();
    return () => {
      entry.stop();
      movement.stop();
    };
  }, [reduce, entrance, orbit]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(false);
    const timeout = setTimeout(() => controller.abort(), 10000);
    loadDiscoveryFeed(controller.signal)
      .then((data) => {
        if (active) setFeed(data);
      })
      .catch(() => {
        if (active) {
          setFeed(empty);
          setError(true);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [reload]);
  const results = useMemo(() => searchDiscovery(feed, query), [feed, query]);
  const login = (destination = 'book') =>
    router.push({ pathname: '/portal', params: { destination } });
  const select = (next: Category) => {
    if (next === 'book') {
      login();
      return;
    }
    setCategory(next);
    setTab(next === 'doctors' ? 'Doctors' : 'Home');
    if (reduce === false) {
      fade.setValue(0.5);
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  };
  const openAvailable = feed.branches.some((b) => reliableOpenStatus(b) !== undefined),
    popularAvailable = feed.branches.some((b) => b.popularityRank != null);
  let branches = results.branches;
  if (filter === 'Open now' && openAvailable)
    branches = branches.filter((b) => reliableOpenStatus(b) === true);
  if (filter === 'Popular' && popularAvailable)
    branches = [...branches].sort(
      (a, b) => (a.popularityRank ?? Infinity) - (b.popularityRank ?? Infinity),
    );
  const searching = query.trim().length > 0;
  const heading = searching
    ? 'Search results'
    : category === 'branches'
      ? 'SRO Clinics (Branches)'
      : category === 'doctors'
        ? 'SRO Doctors'
        : 'Departments';
  const message = (title: string, body: string) => setDetail({ title, body });
  function openPublicDetail(kind: 'branch' | 'doctor' | 'department', id: string) {
    if (kind === 'branch') {
      const branch = feed.branches.find((b) => b.id === id);
      if (!branch) return;
      setDetail({
        title: branch.name,
        body: [branch.location, branch.hours].filter(Boolean).join('\n'),
        links: feed.doctors
          .filter((d) => d.branchIds.includes(id))
          .map((d) => ({ kind: 'doctor', id: d.id, name: d.name })),
      });
    } else if (kind === 'doctor') {
      const doctor = feed.doctors.find((d) => d.id === id);
      if (!doctor) return;
      setDetail({
        title: doctor.name,
        body: doctor.specialization,
        links: feed.branches
          .filter((b) => doctor.branchIds.includes(b.id))
          .map((b) => ({ kind: 'branch', id: b.id, name: b.name })),
      });
    } else {
      const department = feed.departments.find((d) => d.id === id);
      if (!department) return;
      setDetail({
        title: department.name,
        body: department.description,
        links: [
          ...feed.branches
            .filter((b) => department.branchIds.includes(b.id))
            .map((b) => ({ kind: 'branch' as const, id: b.id, name: b.name })),
          ...feed.doctors
            .filter((d) => department.doctorIds.includes(d.id))
            .map((d) => ({ kind: 'doctor' as const, id: d.id, name: d.name })),
        ],
      });
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          inset: -2,
          transform: [
            { translateY: orbit.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
          ],
        }}
      >
        <DecorativeBackground welcome discovery />
      </Animated.View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: Math.max(10 * s, insets.top - 4),
          paddingHorizontal: 20 * s,
          paddingBottom: insets.bottom + 85 * s,
          alignSelf: 'center',
          width: '100%',
          maxWidth: 650,
        }}
      >
        <Animated.View style={{ alignItems: 'center', opacity: entrance }}>
          <Image
            source={require('../../assets/sro-onboarding-brand.png')}
            accessibilityLabel="Social Responsibility Organization"
            resizeMode="contain"
            style={{ width: 138 * s, height: 49 * s }}
          />
          <View style={{ height: 48 * s }} />
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              {
                fontSize: 24 * s,
                letterSpacing: -0.6 * s,
                includeFontPadding: false,
                textAlign: 'center',
              },
            ]}
          >
            Welcome to SRO Clinic
          </Text>
          <Text
            style={[
              styles.body,
              {
                fontSize: 12 * s,
                lineHeight: 13 * s,
                textAlign: 'center',
                marginTop: 3 * s,
                includeFontPadding: false,
              },
            ]}
          >
            Find care, clinics, doctors, and book appointments{'\n'}at SRO Clinic.
          </Text>
        </Animated.View>
        <View
          style={[
            styles.glass,
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10 * s,
              borderRadius: 30,
              paddingLeft: 15 * s,
              paddingRight: 4 * s,
              marginTop: 20 * s,
              minHeight: 36 * s,
            },
          ]}
        >
          <Search color={t.colors.ink} size={19 * s} />
          <TextInput
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            accessibilityLabel="Search clinics, doctors or departments"
            placeholder="Search clinics, doctors or departments"
            placeholderTextColor={t.colors.muted}
            value={query}
            onChangeText={setQuery}
            style={{
              flex: 1,
              minHeight: 32 * s,
              includeFontPadding: false,
              paddingVertical: 4,
              fontFamily: t.fonts.regular,
              fontSize: 11.5 * s,
              color: t.colors.ink,
            }}
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={10}
            >
              <X size={16 * s} color={t.colors.ink} />
            </Pressable>
          )}
          <View
            accessibilityLabel="Voice search unavailable"
            style={{
              width: 33 * s,
              height: 27 * s,
              borderRadius: 20,
              backgroundColor: '#d4f6e9',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Mic color={t.colors.ink} size={17 * s} />
          </View>
        </View>
        <View accessibilityRole="tablist" style={{ gap: 10 * s, marginTop: 12 * s }}>
          {[categories.slice(0, 2), categories.slice(2, 4)].map((row, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: 10 * s }}>
              {row.map((item) => (
                <CategoryCard
                  key={item.key}
                  item={item}
                  scale={s}
                  selected={category === item.key}
                  onPress={() => select(item.key)}
                />
              ))}
            </View>
          ))}
        </View>
        <View
          style={{ flexDirection: 'row', gap: 8 * s, marginTop: 17 * s, alignItems: 'flex-start' }}
        >
          <MapPin color={t.colors.ink} size={22 * s} />
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[
                styles.title,
                { fontSize: 16 * s, lineHeight: 19 * s, includeFontPadding: false },
              ]}
            >
              {heading}
            </Text>
            <Text
              style={[
                styles.body,
                {
                  fontSize: 9.5 * s,
                  lineHeight: 11.5 * s,
                  includeFontPadding: false,
                  marginTop: 2 * s,
                },
              ]}
            >
              {searching
                ? 'Find the right care for your next step.'
                : category === 'branches'
                  ? 'Explore our clinic branches near you.'
                  : category === 'doctors'
                    ? 'Find a doctor and explore their clinic.'
                    : 'Explore medical departments and care teams.'}
            </Text>
          </View>
        </View>
        {category === 'branches' && !searching && (
          <>
            <View
              style={{ flexDirection: 'row', gap: 7 * s, marginTop: 8 * s, marginBottom: 10 * s }}
            >
              {[
                { label: 'Nearby', Icon: MapPin, enabled: false },
                { label: 'Popular', Icon: Flame, enabled: popularAvailable },
                { label: 'Open now', Icon: Clock, enabled: openAvailable },
              ].map(({ label, Icon, enabled }) => (
                <Pressable
                  key={label}
                  hitSlop={{ top: 9, bottom: 9, left: 0, right: 0 }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !enabled, selected: filter === label }}
                  accessibilityHint={
                    enabled ? undefined : 'Verified data for this filter is not available'
                  }
                  onPress={() =>
                    enabled
                      ? setFilter(label)
                      : message(
                          label + ' unavailable',
                          label === 'Nearby'
                            ? 'Nearby sorting requires verified clinic coordinates and your location. Location access is not enabled.'
                            : 'This filter requires verified public clinic information.',
                        )
                  }
                  style={[
                    styles.glass,
                    {
                      minHeight: 26 * s,
                      minWidth: 77 * s,
                      paddingHorizontal: 10 * s,
                      borderRadius: 25,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6 * s,
                      backgroundColor: filter === label ? '#c4fae4b5' : '#ffffff80',
                    },
                  ]}
                >
                  <Icon size={14 * s} color={t.colors.ink} />
                  <Text style={[styles.title, { fontSize: 9 * s }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <Animated.View
          style={{
            opacity: fade,
            gap: 6 * s,
            marginTop: category === 'branches' && !searching ? 0 : 10 * s,
          }}
        >
          {loading ? (
            <View
              style={[
                styles.glass,
                {
                  minHeight: 182 * s,
                  borderRadius: 14 * s,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                },
              ]}
            >
              <ActivityIndicator color={t.colors.ink} />
              <Text style={styles.body}>Loading clinic information…</Text>
            </View>
          ) : error ? (
            <View
              style={[
                styles.glass,
                {
                  minHeight: 166 * s,
                  borderRadius: 14 * s,
                  padding: 14 * s,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7 * s,
                },
              ]}
            >
              <Building2 size={26 * s} color={t.colors.ink} />
              <Text style={[styles.title, { fontSize: 12 * s, textAlign: 'center' }]}>
                Clinic information is unavailable
              </Text>
              <Text
                style={[styles.body, { fontSize: 11 * s, lineHeight: 14 * s, textAlign: 'center' }]}
              >
                We could not load public clinic information. Please try again later.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReload((n) => n + 1)}
                style={{ padding: 12, backgroundColor: '#e9defa', borderRadius: 25 }}
              >
                <Text style={styles.title}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {(category === 'branches' || searching) &&
                branches.map((b) => (
                  <BranchCard
                    key={b.id}
                    branch={b}
                    scale={s}
                    onPress={() => openPublicDetail('branch', b.id)}
                  />
                ))}
              {(category === 'doctors' || searching) &&
                results.doctors.map((d) => (
                  <Pressable
                    key={d.id}
                    accessibilityRole="button"
                    onPress={() => openPublicDetail('doctor', d.id)}
                    style={[
                      styles.glass,
                      {
                        padding: 14 * s,
                        borderRadius: 14 * s,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12 * s,
                      },
                    ]}
                  >
                    <Stethoscope size={27 * s} color={t.colors.ink} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.title, { fontSize: 14 * s }]}>{d.name}</Text>
                      <Text style={[styles.body, { fontSize: 11 * s }]}>{d.specialization}</Text>
                    </View>
                    <ArrowRight size={18 * s} color={t.colors.ink} />
                  </Pressable>
                ))}
              {(category === 'departments' || searching) &&
                results.departments.map((d) => (
                  <Pressable
                    key={d.id}
                    accessibilityRole="button"
                    onPress={() => openPublicDetail('department', d.id)}
                    style={[styles.glass, { padding: 14 * s, borderRadius: 14 * s }]}
                  >
                    <Text style={[styles.title, { fontSize: 14 * s }]}>{d.name}</Text>
                    <Text style={[styles.body, { fontSize: 11 * s }]}>{d.description}</Text>
                  </Pressable>
                ))}
              {(searching
                ? results.branches.length + results.doctors.length + results.departments.length
                : category === 'branches'
                  ? branches.length
                  : category === 'doctors'
                    ? results.doctors.length
                    : results.departments.length) === 0 && (
                <View style={[styles.glass, { padding: 30 * s, borderRadius: 14 * s }]}>
                  <Text style={[styles.title, { fontSize: 14 * s }]}>No results found</Text>
                  <Text style={styles.body}>Try another search or category.</Text>
                </View>
              )}
            </>
          )}
        </Animated.View>
        <View style={{ marginTop: 10 * s }}>
          <BookingPrompt scale={s} onPress={() => login()} />
        </View>
      </ScrollView>
      <View
        style={[
          styles.glass,
          {
            position: 'absolute',
            bottom: Math.max(insets.bottom, 6) + 4 * s,
            left: 12 * s,
            right: 12 * s,
            borderRadius: 40,
            flexDirection: 'row',
            padding: 3 * s,
            minHeight: 47 * s,
            backgroundColor: '#fcfbffda',
          },
        ]}
      >
        {[
          { title: 'Home', Icon: Home },
          { title: 'Doctors', Icon: Stethoscope },
          { title: 'Bookings', Icon: CalendarDays },
          { title: 'Profile', Icon: UserRound },
        ].map(({ title, Icon }) => (
          <Pressable
            key={title}
            hitSlop={{ top: 3, bottom: 3, left: 0, right: 0 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === title }}
            onPress={() => {
              if (title === 'Bookings' || title === 'Profile') {
                login(title === 'Bookings' ? 'appointments' : 'profile');
                return;
              }
              setTab(title);
              setCategory(title === 'Doctors' ? 'doctors' : 'branches');
              setQuery('');
              if (reduce === false) {
                fade.setValue(0.5);
                Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
              }
            }}
            style={{
              flex: 1,
              minHeight: 40 * s,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 35,
              gap: 2 * s,
            }}
          >
            <SelectionFill selected={tab === title} reduced={reduce !== false} />
            <Icon
              size={21 * s}
              color={tab === title ? '#6502bc' : '#695c9b'}
              fill={title === 'Home' && tab === 'Home' ? '#6502bc' : 'none'}
              strokeWidth={1.7}
            />
            <Text
              style={{
                fontFamily: tab === title ? t.fonts.bold : t.fonts.regular,
                fontSize: 9 * s,
                color: tab === title ? t.colors.ink : '#695c9b',
              }}
            >
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!detail}
        transparent
        animationType={reduce !== false ? 'none' : 'fade'}
        onRequestClose={() => setDetail(null)}
      >
        <View
          style={{ flex: 1, backgroundColor: '#21143a70', padding: 24, justifyContent: 'center' }}
        >
          <View
            accessibilityViewIsModal
            style={{ backgroundColor: '#fcfaff', borderRadius: 24, padding: 24, gap: 18 }}
          >
            <Text accessibilityRole="header" style={[styles.title, { fontSize: 24 }]}>
              {detail?.title}
            </Text>
            <Text style={[styles.body, { fontSize: 16, lineHeight: 24 }]}>{detail?.body}</Text>
            {detail?.links?.map((link) => (
              <Pressable
                key={link.kind + link.id}
                accessibilityRole="button"
                onPress={() => openPublicDetail(link.kind, link.id)}
                style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Text style={[styles.title, { flex: 1 }]}>{link.name}</Text>
                <ArrowRight size={20} color={t.colors.ink} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setDetail(null)}
              style={{ padding: 14, alignSelf: 'flex-end' }}
            >
              <Text style={styles.title}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
