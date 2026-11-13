import { ref, computed, watch } from 'vue';

const EVENTS_API_URL = 'https://6af6e115e844c7ff741bbc39.mockapi.io/api/v1/events';
const REGISTRATIONS_STORAGE_KEY = 'gatherly_user_registrations';

const savedRegs = localStorage.getItem(REGISTRATIONS_STORAGE_KEY);
const userRegistrations = ref(savedRegs ? JSON.parse(savedRegs) : []);
const events = ref([]);
const isLoading = ref(true);
const loadError = ref('');

watch(
  userRegistrations,
  (newRegs) => {
    localStorage.setItem(REGISTRATIONS_STORAGE_KEY, JSON.stringify(newRegs));
  },
  { deep: true }
);

const normalizeEvent = (event) => {
  const id = Number(event?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('The events API returned an event with an invalid ID.');
  }

  return {
    ...event,
    id,
    quota: Number(event.quota),
    done: Boolean(event.done)
  };
};

const request = async (path = '', options = {}) => {
  const response = await fetch(`${EVENTS_API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Events API request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ''}`
    );
  }

  return response.status === 204 ? null : response.json();
};

const loadEvents = async () => {
  isLoading.value = true;
  loadError.value = '';
  try {
    const data = await request();
    if (!Array.isArray(data)) {
      throw new Error('The events API returned an invalid event list.');
    }
    events.value = data.map(normalizeEvent);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Unable to load events.';
  } finally {
    isLoading.value = false;
  }
};

void loadEvents();

export function useEvents() {
  const totalEvents = computed(() => events.value.length);
  const activeEvents = computed(() => events.value.filter((event) => !event.done));
  const completedEvents = computed(() => events.value.filter((event) => event.done));
  const totalRegistrations = computed(() => userRegistrations.value.length);

  const createEvent = async (eventData) => {
    const cleanLoc = eventData.loc.replace(/^[📍\s]+/, '').trim();
    const payload = {
      title: eventData.title.trim(),
      date: eventData.date,
      loc: cleanLoc,
      cat: eventData.cat,
      quota: Number(eventData.quota) || 100,
      desc: eventData.desc.trim(),
      done: false
    };
    const newEvent = normalizeEvent(
      await request('', { method: 'POST', body: JSON.stringify(payload) })
    );
    events.value.unshift(newEvent);
    return newEvent;
  };

  const completeEvent = async (id) => {
    const target = events.value.find((event) => event.id === Number(id));
    if (!target) return;

    const updatedEvent = normalizeEvent(
      await request(`/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: true })
      })
    );
    Object.assign(target, updatedEvent);
  };

  const deleteEvent = async (id) => {
    const numId = Number(id);
    await request(`/${numId}`, { method: 'DELETE' });
    const index = events.value.findIndex((event) => event.id === numId);
    if (index !== -1) events.value.splice(index, 1);
    userRegistrations.value = userRegistrations.value.filter(
      (registration) => registration.eventId !== numId
    );
  };

  const getEventById = (id) => {
    return events.value.find((event) => event.id === Number(id));
  };

  const registerAttendee = async (eventId, participantData) => {
    const event = getEventById(eventId);
    if (!event || event.quota <= 0) return null;

    const updatedEvent = normalizeEvent(
      await request(`/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quota: Math.max(0, event.quota - 1) })
      })
    );
    Object.assign(event, updatedEvent);

    const bookingCode = 'GTH-' + Date.now().toString().slice(-4);
    const regRecord = {
      id: Date.now(),
      eventId: event.id,
      eventTitle: event.title,
      eventCat: event.cat,
      eventDate: event.date,
      eventLoc: event.loc,
      bookingCode,
      registeredAt: new Date().toISOString(),
      fullName: participantData.fullName.trim(),
      email: participantData.email.trim(),
      phone: participantData.phone.trim(),
      dob: participantData.dob,
      reason: participantData.reason.trim()
    };

    userRegistrations.value.unshift(regRecord);
    return regRecord;
  };

  const isUserRegistered = (eventId) => {
    const numId = Number(eventId);
    if (!events.value.some((event) => event.id === numId)) return false;
    return userRegistrations.value.some((registration) => registration.eventId === numId);
  };

  const getRegistrationByEventId = (eventId) => {
    return userRegistrations.value.find(
      (registration) => registration.eventId === Number(eventId)
    );
  };

  const cancelRegistration = async (eventId) => {
    const numId = Number(eventId);
    const registrationIndex = userRegistrations.value.findIndex(
      (registration) => registration.eventId === numId
    );
    if (registrationIndex === -1) return false;

    const event = getEventById(numId);
    if (event) {
      const updatedEvent = normalizeEvent(
        await request(`/${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ quota: event.quota + 1 })
        })
      );
      Object.assign(event, updatedEvent);
    }

    userRegistrations.value.splice(registrationIndex, 1);
    return true;
  };

  const clearAllEvents = () => {
    events.value = [];
  };

  const clearAllRegistrations = () => {
    userRegistrations.value = [];
    localStorage.removeItem(REGISTRATIONS_STORAGE_KEY);
  };

  return {
    events,
    isLoading,
    loadError,
    loadEvents,
    totalEvents,
    activeEvents,
    completedEvents,
    userRegistrations,
    totalRegistrations,
    createEvent,
    completeEvent,
    deleteEvent,
    getEventById,
    registerAttendee,
    isUserRegistered,
    getRegistrationByEventId,
    cancelRegistration,
    clearAllEvents,
    clearAllRegistrations
  };
}
