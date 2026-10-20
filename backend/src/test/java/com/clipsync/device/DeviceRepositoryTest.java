package com.clipsync.device;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("DEVICE: Device Repository & Revocation Suite")
class DeviceRepositoryTest {

    private InMemoryDeviceRepository repository;

    @BeforeEach
    void setUp() {
        repository = new InMemoryDeviceRepository();
    }

    @Test
    @DisplayName("DEV-01: Register initiator and joiner devices")
    void registerDevices() {
        String sessionId = "sess-dev-01";
        Device devA = new Device("dev-alpha", sessionId, "signing-key-a", "hpke-key-a", DeviceRole.INITIATOR, DeviceStatus.ACTIVE, Instant.now());
        Device devB = new Device("dev-beta", sessionId, "signing-key-b", "hpke-key-b", DeviceRole.JOINER, DeviceStatus.ACTIVE, Instant.now());

        repository.save(devA);
        repository.save(devB);

        Optional<Device> foundA = repository.findBySessionAndDeviceId(sessionId, "dev-alpha");
        assertThat(foundA).isPresent();
        assertThat(foundA.get().role()).isEqualTo(DeviceRole.INITIATOR);

        List<Device> active = repository.findActiveDevices(sessionId);
        assertThat(active).hasSize(2);
    }

    @Test
    @DisplayName("DEV-02: Revoking a device transitions its status and filters from active list")
    void revokeDevice() {
        String sessionId = "sess-dev-02";
        Device devA = new Device("dev-alpha", sessionId, "key-a", "hpke-a", DeviceRole.INITIATOR, DeviceStatus.ACTIVE, Instant.now());
        Device devB = new Device("dev-beta", sessionId, "key-b", "hpke-b", DeviceRole.JOINER, DeviceStatus.ACTIVE, Instant.now());

        repository.save(devA);
        repository.save(devB);

        repository.revokeDevice(sessionId, "dev-beta");

        Optional<Device> revoked = repository.findBySessionAndDeviceId(sessionId, "dev-beta");
        assertThat(revoked).isPresent();
        assertThat(revoked.get().status()).isEqualTo(DeviceStatus.REVOKED);

        List<Device> active = repository.findActiveDevices(sessionId);
        assertThat(active).hasSize(1);
        assertThat(active.getFirst().deviceId()).isEqualTo("dev-alpha");
    }
}
