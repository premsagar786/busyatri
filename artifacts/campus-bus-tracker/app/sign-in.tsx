import { useRouter, type Href } from 'expo-router';
import { useSignIn } from '@clerk/expo';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const busy = fetchStatus === 'fetching';

  const submit = async () => {
    setMessage('');
    const result = await signIn.password({ emailAddress: email.trim(), password });
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ decorateUrl }) =>
          router.replace(decorateUrl('/') as Href),
      });
      return;
    }
    setMessage('This sign-in needs another verification step. Contact your college administrator.');
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Text style={styles.markText}>C</Text>
        </View>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>CAMPUS TRANSPORT</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Sign in to follow your campus buses.
        </Text>

        <Text style={[styles.label, { color: colors.foreground }]}>College email</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="name@college.edu"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
          ]}
          testID="sign-in-email"
        />
        <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
        <TextInput
          autoComplete="current-password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
          ]}
          testID="sign-in-password"
        />
        {!!message && (
          <Text style={[styles.message, { color: colors.destructive }]}>
            {message || errors.fields.identifier?.message || errors.fields.password?.message}
          </Text>
        )}
        <Pressable
          onPress={submit}
          disabled={!email.trim() || !password || busy}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            (!email.trim() || !password || busy) && styles.disabled,
            pressed && styles.pressed,
          ]}
          testID="sign-in-submit"
        >
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : (
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
              Sign in
            </Text>
          )}
        </Pressable>
        <View style={styles.footer}>
          <Text style={{ color: colors.mutedForeground }}>New to your campus app? </Text>
          <Pressable onPress={() => router.push('/sign-up')}>
            <Text style={[styles.link, { color: colors.primary }]}>Create account</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 68 },
  container: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  mark: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  markText: { color: '#ffffff', fontSize: 25, fontWeight: '800' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.7, marginBottom: 12 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 23, marginTop: 8, marginBottom: 30 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 14 },
  input: { height: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, fontSize: 15 },
  message: { marginTop: 12, fontSize: 13, lineHeight: 18 },
  primaryButton: { height: 54, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryButtonText: { fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  link: { fontWeight: '800' },
});
