import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export const CURRENCIES = [
  { code: 'XOF', symbol: 'F CFA', name: 'Franc CFA (BCEAO)' },
  { code: 'XAF', symbol: 'F CFA', name: 'Franc CFA (BEAC)' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'Livre Sterling' },
  { code: 'CHF', symbol: 'CHF', name: 'Franc Suisse' },
  { code: 'MAD', symbol: 'MAD', name: 'Dirham Marocain' },
  { code: 'TND', symbol: 'DT', name: 'Dinar Tunisien' },
  { code: 'DZD', symbol: 'DA', name: 'Dinar Algérien' },
  { code: 'ZAR', symbol: 'R', name: 'Rand Sud-Africain' }
];

export const formatCurrency = (amount: number, currencyCode: string) => {
  const curr = CURRENCIES.find(c => c.code === currencyCode);
  if (!curr) return `${amount.toFixed(2)}`;
  if (['XOF', 'XAF', 'MAD', 'TND', 'DZD'].includes(currencyCode)) {
    return `${amount.toLocaleString('fr-FR')} ${curr.symbol}`;
  }
  try {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: currencyCode });
  } catch (e) {
    return `${amount.toLocaleString('fr-FR')} ${curr.symbol}`;
  }
};

export interface FinancialTransaction {
  id?: string;
  date: any;
  userId: string;
  username: string;
  licenseId: string;
  amountPaid: number;
  promoCode: string;
  commissionPromo: number;
  commissionPartner: number;
  amountSmartWorkBook: number;
  status: 'paid' | 'refunded';
}

export interface LicenseParams {
  id: string;
  name: string;
  price3m: number;
  price6m: number;
  price12m: number;
  promoCommission: number; // Percentage
  partnerCommission: number; // Percentage
  status: 'active' | 'inactive';
}

export const DEFAULT_LICENSE_PARAMS: Record<string, Omit<LicenseParams, 'id'>> = {
  ECN: { name: 'ECN (Médecine)', price3m: 30, price6m: 50, price12m: 80, promoCommission: 10, partnerCommission: 15, status: 'active' },
  IDE: { name: 'IDE (Infirmier)', price3m: 25, price6m: 40, price12m: 70, promoCommission: 12, partnerCommission: 15, status: 'active' },
  EM: { name: 'EM (Études Médicales)', price3m: 35, price6m: 60, price12m: 90, promoCommission: 10, partnerCommission: 15, status: 'active' },
  TIM: { name: 'TIM (Imagerie Médicale)', price3m: 25, price6m: 40, price12m: 70, promoCommission: 10, partnerCommission: 15, status: 'active' },
  SF: { name: 'Sage-femme', price3m: 25, price6m: 40, price12m: 70, promoCommission: 10, partnerCommission: 15, status: 'active' },
  KINE: { name: 'Kinésithérapie', price3m: 28, price6m: 45, price12m: 75, promoCommission: 10, partnerCommission: 15, status: 'active' },
  PHARMA: { name: 'Pharmacie', price3m: 30, price6m: 50, price12m: 80, promoCommission: 10, partnerCommission: 15, status: 'active' },
  ALL: { name: 'Toutes filières', price3m: 20, price6m: 35, price12m: 60, promoCommission: 10, partnerCommission: 15, status: 'active' }
};

export async function fetchLicenseParams(licenseId: string): Promise<LicenseParams> {
  try {
    const docRef = doc(db, 'licenseParams', licenseId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: licenseId, ...docSnap.data() } as LicenseParams;
    }
  } catch (error) {
    console.warn(`Could not fetch params for license ${licenseId}, using constants default`, error);
  }
  const fallback = DEFAULT_LICENSE_PARAMS[licenseId] || DEFAULT_LICENSE_PARAMS.ALL;
  return { id: licenseId, ...fallback };
}

export async function recordFinancialTransaction(params: {
  userId: string;
  username: string;
  licenseId: string;
  durationMonths: number;
  promoCodeUsed?: string;
  partnerId?: string;
}) {
  const { userId, username, licenseId, durationMonths, promoCodeUsed, partnerId } = params;

  if (!durationMonths || durationMonths <= 0) return;

  const settings = await fetchLicenseParams(licenseId);

  let price = 0;
  if (durationMonths === 1) {
    price = Math.round((settings.price3m / 3) * 1.2); // Fallback estimate
  } else if (durationMonths === 3) {
    price = settings.price3m;
  } else if (durationMonths === 6) {
    price = settings.price6m;
  } else if (durationMonths === 12) {
    price = settings.price12m;
  } else {
    // If it's another non-zero number, estimate
    price = durationMonths * 10;
  }

  if (price === 0) return;

  // Compute commissions (Percentages)
  const commPromoPct = settings.promoCommission;
  const commPartnerPct = settings.partnerCommission;

  const commissionPromo = promoCodeUsed ? Math.round((price * (commPromoPct / 100)) * 100) / 100 : 0;
  const commissionPartner = (partnerId || promoCodeUsed) ? Math.round((price * (commPartnerPct / 100)) * 100) / 100 : 0;
  const amountSmartWorkBook = Math.round((price - commissionPromo - commissionPartner) * 100) / 100;

  try {
    await addDoc(collection(db, 'financialHistory'), {
      date: serverTimestamp(),
      userId,
      username,
      licenseId,
      amountPaid: price,
      promoCode: promoCodeUsed || '',
      commissionPromo,
      commissionPartner,
      amountSmartWorkBook,
      partnerId: partnerId || '',
      status: 'paid'
    });
    console.log(`Financial transaction successfully registered for ${username}`);
  } catch (e) {
    console.error("Failed to record financial transaction", e);
  }
}
