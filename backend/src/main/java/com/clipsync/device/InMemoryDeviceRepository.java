package com.clipsync.device;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class InMemoryDeviceRepository implements DeviceRepository {

    // Key: sessionId:deviceId -> Device
    private final Map<String, Device> store = new ConcurrentHashMap<>();

    private String key(String sessionId, String deviceId) {
        return sessionId + ":" + deviceId;
    }

    @Override
    public void save(Device device) {
        store.put(key(device.sessionId(), device.deviceId()), device);
    }

    @Override
    public Optional<Device> findBySessionAndDeviceId(String sessionId, String deviceId) {
        return Optional.ofNullable(store.get(key(sessionId, deviceId)));
    }

    @Override
    public List<Device> findActiveDevices(String sessionId) {
        return store.values().stream()
            .filter(d -> d.sessionId().equals(sessionId) && d.status() == DeviceStatus.ACTIVE)
            .collect(Collectors.toList());
    }

    @Override
    public void revokeDevice(String sessionId, String deviceId) {
        store.computeIfPresent(key(sessionId, deviceId), (k, current) -> new Device(
            current.deviceId(),
            current.sessionId(),
            current.publicSigningKeyB64(),
            current.publicHpkeKeyB64(),
            current.role(),
            DeviceStatus.REVOKED,
            current.joinedAt()
        ));
    }

    @Override
    public void deleteAllForSession(String sessionId) {
        store.keySet().removeIf(k -> k.startsWith(sessionId + ":"));
    }
}
