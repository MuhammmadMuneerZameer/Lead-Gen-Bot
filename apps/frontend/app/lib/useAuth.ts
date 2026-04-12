"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, getUser } from './api';

export function useAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token && pathname !== '/login') {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [pathname, router]);

  return { ready, user: getUser() };
}
