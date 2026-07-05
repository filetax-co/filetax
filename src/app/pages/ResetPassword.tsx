import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { usePageMeta } from '../hooks/usePageMeta';

export function ResetPassword() {
  usePageMeta({
    title: 'Set New Password | FileTax.co',
    description: 'Set a new password for your FileTax.co account.',
  });

  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token_hash = params.get('token_hash');
    const type = params.get('type');

    async function exchangeRecoveryToken() {
      // PKCE-style recovery link — must explicitly exchange the token_hash
      // for a session. The Supabase client does NOT do this automatically
      // for token_hash links, only for the older implicit-flow fragment
      // tokens or the newer `code` param (handled via detectSessionInUrl).
      if (token_hash && type === 'recovery') {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash,
          type: 'recovery',
        });
        if (!verifyError) {
          setSessionReady(true);
          return;
        }
        setError('This reset link is invalid or has expired. Please request a new one.');
        return;
      }

      // Fallback: a session may already exist (implicit flow already
      // resolved it, or the user reloaded this page after exchange).
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setSessionReady(true);
    }

    exchangeRecoveryToken();

    // Still listen for PASSWORD_RECOVERY in case the SDK resolves the
    // session asynchronously via detectSessionInUrl (
