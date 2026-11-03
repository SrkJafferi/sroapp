import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Path,
  Circle,
  G,
} from 'react-native-svg';
// Native vectors follow the reference's 941 × 1672 composition, not a screen bitmap.
export function DecorativeBackground({
  welcome = false,
  discovery = false,
}: {
  welcome?: boolean;
  discovery?: boolean;
}) {
  const cy = discovery ? 310 : welcome ? 390 : 705;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Svg width="100%" height="100%" viewBox="0 0 941 1672" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="base" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop stopColor="#f6f1ff" />
            <Stop offset=".52" stopColor="#fdfdff" />
            <Stop offset="1" stopColor="#eeecff" />
          </LinearGradient>
          <RadialGradient id="lav">
            <Stop stopColor="#cbbbf7" stopOpacity=".45" />
            <Stop offset="1" stopColor="#d8ccff" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="mint">
            <Stop stopColor="#b8f2e3" stopOpacity=".42" />
            <Stop offset="1" stopColor="#c6f8ed" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="white">
            <Stop stopColor="white" stopOpacity=".96" />
            <Stop offset="1" stopColor="white" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="wave" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop stopColor="#c4b0ef" stopOpacity=".65" />
            <Stop offset="1" stopColor="#f0eaff" stopOpacity=".45" />
          </LinearGradient>
          <LinearGradient id="sea" x1="0%" y1="100%" x2="100%" y2="0%">
            <Stop stopColor="#d5f4ec" stopOpacity=".25" />
            <Stop offset=".6" stopColor="#9debd4" stopOpacity=".7" />
            <Stop offset="1" stopColor="#d2f4f3" stopOpacity=".6" />
          </LinearGradient>
        </Defs>
        <Rect width="941" height="1672" fill="url(#base)" />
        <Circle cx="215" cy="240" r="540" fill="url(#lav)" />
        <Circle cx="865" cy="420" r="400" fill="url(#mint)" />
        <Circle cx="480" cy="970" r="690" fill="url(#lav)" />
        <Circle cx="450" cy="750" r="490" fill="url(#white)" />
        <Path
          d="M0 215 C140 112 283 154 414 0 H0Z"
          fill="url(#wave)"
          stroke="white"
          strokeOpacity=".55"
        />
        <G fill="none" stroke="white">
          <Circle cx="469" cy={cy} r={welcome ? 337 : 455} strokeWidth="2" opacity=".6" />
          <Circle cx="465" cy={cy + 4} r={welcome ? 300 : 383} strokeWidth="3" opacity=".75" />
          {!welcome && <Circle cx="450" cy="720" r="348" strokeWidth="25" opacity=".15" />}
        </G>
        {(welcome
          ? [
              [337, 106],
              [141, 314],
              [789, 345],
            ]
          : [
              [118, 408],
              [95, 604],
              [846, 735],
            ]
        ).map(([x, y]) => (
          <G key={x}>
            <Circle cx={x} cy={y} r="21" fill="url(#white)" />
            <Circle cx={x} cy={y} r={welcome ? 8 : 10} fill="white" />
          </G>
        ))}
        <G
          fill="#a6e2d8"
          fillOpacity=".8"
          stroke="white"
          strokeWidth="2.5"
          transform={welcome ? 'translate(150 -48) scale(.82)' : undefined}
        >
          <Path d="M763 201 Q763 194 770 194 H784 Q791 194 791 201 V222 H813 Q820 222 820 229 V245 Q820 252 813 252 H791 V275 Q791 282 784 282 H770 Q763 282 763 275 V252 H741 Q734 252 734 245 V229 Q734 222 741 222 H763Z" />
          <Path d="M850 299 V291 Q850 286 855 286 H863 Q868 286 868 291 V299 H877 Q882 299 882 304 V312 Q882 317 877 317 H868 V327 Q868 332 863 332 H855 Q850 332 850 327 V317 H841 Q836 317 836 312 V304 Q836 299 841 299Z" />
        </G>
        <G
          fill="#c9b9f8"
          fillOpacity=".65"
          stroke="white"
          strokeWidth="2.4"
          transform={welcome ? 'translate(-25 530) scale(.8)' : undefined}
        >
          <Path d="M106 1117 Q106 1110 113 1110 H124 Q131 1110 131 1117 V1134 H148 Q155 1134 155 1141 V1153 Q155 1160 148 1160 H131 V1177 Q131 1184 124 1184 H113 Q106 1184 106 1177 V1160 H89 Q82 1160 82 1153 V1141 Q82 1134 89 1134 H106Z" />
          <Path d="M194 1183 Q194 1179 198 1179 H204 Q208 1179 208 1183 V1192 H217 Q221 1192 221 1196 V1202 Q221 1206 217 1206 H208 V1215 Q208 1219 204 1219 H198 Q194 1219 194 1215 V1206 H185 Q181 1206 181 1202 V1196 Q181 1192 185 1192 H194Z" />
        </G>
        {[
          { x: welcome ? 62 : 71, y: welcome ? 201 : 279 },
          { x: welcome ? 827 : 808, y: welcome ? 1541 : 1276 },
        ].map((p) => (
          <G key={p.x} fill="white" opacity=".85">
            {Array.from({ length: 9 }, (_, i) => (
              <Circle key={i} cx={p.x + (i % 3) * 25} cy={p.y + Math.floor(i / 3) * 25} r="3.8" />
            ))}
          </G>
        ))}
        <G transform={welcome ? 'translate(0 855) scale(1 .51)' : undefined}>
          <Path
            d="M0 1204 C170 1224 268 1378 475 1368 S728 1190 941 1200 V1672 H0Z"
            fill="url(#wave)"
          />
          <Path
            d="M0 1460 C190 1320 363 1490 555 1303 S803 1090 941 1073 V1672 H0Z"
            fill="url(#sea)"
          />
          <Path
            d="M0 1277 C220 1286 386 1441 590 1392 S798 1185 941 1198 V1672 H0Z"
            fill="url(#wave)"
            stroke="white"
            strokeOpacity=".55"
          />
          <Path
            d="M0 1512 C171 1350 307 1476 479 1388 S734 1487 941 1353 V1672 H0Z"
            fill="white"
            fillOpacity=".42"
          />
          <Path
            d="M0 1512 C171 1350 307 1476 479 1388"
            fill="none"
            stroke="white"
            strokeWidth="3"
            opacity=".8"
          />
        </G>
        <Circle cx="470" cy="1650" r="420" fill="url(#white)" opacity=".7" />
      </Svg>
    </View>
  );
}
