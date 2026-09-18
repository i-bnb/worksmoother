import {
  WhatsAppConfig,
  WhatsAppMessagePayload,
  WhatsAppSendResult,
} from '../types/index.js';

/**
 * Meta WhatsApp Cloud API Client
 * Uses Meta Graph API v20.0 to send templated and interactive WhatsApp messages
 * for appointment confirmations and clinical reminders.
 */
export async function sendWhatsAppMessage(
  config: WhatsAppConfig,
  payload: WhatsAppMessagePayload
): Promise<WhatsAppSendResult> {
  const { phoneNumberId, accessToken, apiVersion = 'v20.0' } = config;

  // Clean phone number: remove '+' and any whitespace
  const cleanPhone = payload.to.replace(/[^0-9]/g, '');

  // Offline / development / test mock mode
  if (
    !phoneNumberId ||
    !accessToken ||
    accessToken === 'mock_whatsapp_token' ||
    accessToken.startsWith('mock_') ||
    phoneNumberId === 'mock_phone_id' ||
    phoneNumberId.startsWith('mock_')
  ) {
    const mockMessageId = `wamid.HBg${Math.random().toString(36).substring(2, 15).toUpperCase()}==`;
    return {
      success: true,
      messageId: mockMessageId,
      recipient: cleanPhone,
      mock: true,
    };
  }

  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const requestBody: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: payload.type,
  };

  if (payload.type === 'template' && payload.template) {
    requestBody.template = payload.template;
  } else if (payload.type === 'text' && payload.text) {
    requestBody.text = payload.text;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        recipient: cleanPhone,
        error: `Meta WhatsApp API error (${response.status}): ${errorText}`,
      };
    }

    const data = (await response.json()) as any;
    const messageId = data.messages?.[0]?.id || `wamid.${Math.random().toString(36).substring(2, 12)}`;

    return {
      success: true,
      messageId,
      recipient: cleanPhone,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown WhatsApp dispatch error';
    return {
      success: false,
      recipient: cleanPhone,
      error: errorMsg,
    };
  }
}

/**
 * Builds Meta WhatsApp Cloud API payload for Appointment Confirmation
 */
export function buildAppointmentConfirmationWhatsApp(params: {
  patientPhone: string;
  patientName: string;
  doctorName: string;
  appointmentTime: string;
  bookingId: string;
  hospitalName?: string;
}): WhatsAppMessagePayload {
  const hospital = params.hospitalName || 'DoctorCare Hospital';

  return {
    to: params.patientPhone,
    type: 'template',
    template: {
      name: 'appointment_confirmation',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.patientName },
            { type: 'text', text: params.doctorName },
            { type: 'text', text: params.appointmentTime },
            { type: 'text', text: params.bookingId },
            { type: 'text', text: hospital },
          ],
        },
      ],
    },
    text: {
      body: `Hello ${params.patientName}, your appointment with ${params.doctorName} at ${hospital} is confirmed for ${params.appointmentTime}. Booking ID: ${params.bookingId}.`,
    },
  };
}

/**
 * Builds Meta WhatsApp Cloud API payload for Appointment Reminder
 */
export function buildAppointmentReminderWhatsApp(params: {
  patientPhone: string;
  patientName: string;
  doctorName: string;
  appointmentTime: string;
  hospitalName?: string;
}): WhatsAppMessagePayload {
  const hospital = params.hospitalName || 'DoctorCare Hospital';

  return {
    to: params.patientPhone,
    type: 'template',
    template: {
      name: 'appointment_reminder',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: params.patientName },
            { type: 'text', text: params.doctorName },
            { type: 'text', text: params.appointmentTime },
            { type: 'text', text: hospital },
          ],
        },
      ],
    },
    text: {
      body: `Reminder: Hello ${params.patientName}, you have an upcoming consultation with ${params.doctorName} on ${params.appointmentTime} at ${hospital}. Please arrive 15 minutes early.`,
    },
  };
}
