import { useState } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission | 'default'>('default');
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  const requestPermission = async () => {
    console.log("Push notifications have been disabled to ensure stability on iOS.");
  };

  return { permission, fcmToken, requestPermission };
}

