package com.clipsync.discovery;

import java.util.Optional;

public interface IpDiscoveryRepository {
    void save(IpDiscoveryRecord record);
    Optional<IpDiscoveryRecord> findByIpHash(String ipHash);
    void delete(String ipHash);
}
