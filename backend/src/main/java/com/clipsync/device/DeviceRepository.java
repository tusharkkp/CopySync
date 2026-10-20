package com.clipsync.device;

import java.util.List;
import java.util.Optional;

public interface DeviceRepository {
    void save(Device device);
    Optional<Device> findBySessionAndDeviceId(String sessionId, String deviceId);
    List<Device> findActiveDevices(String sessionId);
    void revokeDevice(String sessionId, String deviceId);
    void deleteAllForSession(String sessionId);
}
