import { useRouter, type Href } from 'expo-router';
import { useOAuth, useSignUp } from '@clerk/expo';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
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

WebBrowser.maybeCompleteAuthSession();

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { startOAuthFlow: startGoogleFlow } = useOAuth({ strategy: 'oauth_google' });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [sentCode, setSentCode] = useState(false);
  const busy = fetchStatus === 'fetching';

  const signUpWithGoogle = async () => {
    setMessage('');
    try {
      const { createdSessionId, setActive } = await startGoogleFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/' as Href);
        return;
      }
      setMessage('Google sign-up needs another step — finish it in the browser and try again.');
    } catch (err) {
      const message =
        (err as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ??
        'Google sign-up failed. Try again.';
      setMessage(message);
    }
  };

  const createAccount = async () => {
    setMessage('');
    const result = await signUp.password({
      emailAddress: email.trim(),
      password,
      firstName: name.trim(),
    });
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    const sent = await signUp.verifications.sendEmailCode();
    if (sent.error) {
      setMessage(sent.error.message);
      return;
    }
    setSentCode(true);
  };

  const verify = async () => {
    setMessage('');
    const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    // Finalize directly: the signUp status signal does not update in place,
    // so reading signUp.status here always sees the pre-submit value.
    try {
      await signUp.finalize({
        navigate: ({ decorateUrl }) =>
          router.replace(decorateUrl('/') as Href),
      });
    } catch {
      setMessage('Your account still needs another setup step.');
    }
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
        <Text style={[styles.title, { color: colors.foreground }]}>
          {sentCode ? 'Check your email' : 'Create your account'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {sentCode
            ? `Enter the verification code sent to ${email}.`
            : 'Use your college email to join campus transport.'}
        </Text>

        {!sentCode ? (
          <>
            <Text style={[styles.label, { color: colors.foreground }]}>Full name</Text>
            <TextInput
              autoComplete="name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              testID="sign-up-name"
            />
            <Text style={[styles.label, { color: colors.foreground }]}>College email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="name@college.edu"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              testID="sign-up-email"
            />
            <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
            <TextInput
              autoComplete="new-password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Create a password"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              testID="sign-up-password"
            />
          </>
        ) : (
          <TextInput
            autoCapitalize="none"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            placeholder="Email verification code"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            testID="sign-up-code"
          />
        )}
        <View nativeID="clerk-captcha" />
        {!!message && <Text style={[styles.message, { color: colors.destructive }]}>{message}</Text>}
        {!message && !sentCode && errors.fields.emailAddress?.message && (
          <Text style={[styles.message, { color: colors.destructive }]}>{errors.fields.emailAddress.message}</Text>
        )}

        <Pressable
          onPress={sentCode ? verify : createAccount}
          disabled={busy || (sentCode ? code.trim().length < 4 : !name.trim() || !email.trim() || password.length < 8)}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            (busy || (sentCode ? code.trim().length < 4 : !name.trim() || !email.trim() || password.length < 8)) && styles.disabled,
            pressed && styles.pressed,
          ]}
          testID="sign-up-submit"
        >
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : (
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
              {sentCode ? 'Verify email' : 'Create account'}
            </Text>
          )}
        </Pressable>
        {!sentCode && (
          <>
            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>
            <Pressable
              onPress={signUpWithGoogle}
              disabled={busy}
              style={({ pressed }) => [
                styles.googleButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                busy && styles.disabled,
                pressed && styles.pressed,
              ]}
              testID="sign-up-google"
            >
              <Ionicons name="logo-google" size={18} color={colors.foreground} />
              <Text style={[styles.googleButtonText, { color: colors.foreground }]}>
                Continue with Google
              </Text>
            </Pressable>
          </>
        )}
        {sentCode && (
          <Pressable
            onPress={() => signUp.verifications.sendEmailCode()}
            style={styles.resend}
            disabled={busy}
          >
            <Text style={[styles.link, { color: colors.primary }]}>Send a new code</Text>
          </Pressable>
        )}
        <View style={styles.footer}>
          <Text style={{ color: colors.mutedForeground }}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/sign-in')}>
            <Text style={[styles.link, { color: colors.primary }]}>Sign in</Text>
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
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 23, marginTop: 8, marginBottom: 22 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 12 },
  input: { height: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, fontSize: 15 },
  message: { marginTop: 12, fontSize: 13, lineHeight: 18 },
  primaryButton: { height: 54, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  primaryButtonText: { fontSize: 15, fontWeight: '800' },
  divider: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 12 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '700' },
  googleButton: { height: 54, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderWidth: 1, flexDirection: 'row', gap: 10 },
  googleButtonText: { fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 22 },
  link: { fontWeight: '800' },
  resend: { alignItems: 'center', marginTop: 16 },
});
