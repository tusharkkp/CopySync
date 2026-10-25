# Cisco Packet Tracer Implementation: CopySync Dual-Mode Network Simulation

> **Project:** CopySync (End-to-End Encrypted Real-Time Hybrid Clipboard Sync)  
> **Topology Name:** `CopySync_Hybrid_Network`  
> **Packet Tracer File:** [`CopySync_Network_Simulation.pkt`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/CopySync_Network_Simulation.pkt)  
> **Scripts Directory:** [`packet_tracer/CopySync_PacketTracer/`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/)  
> **Status:** Validated, Generated & Ready for Simulation  

---

## 1. Executive Summary & CopySync Architectural Context

CopySync is an End-to-End Encrypted (E2EE) real-time clipboard synchronization platform designed with a **Dual-Mode Hybrid Architecture**. It delivers zero-friction instant clipboard sync when devices are co-located, while guaranteeing universal reachability across distinct networks without user intervention.

### Dual-Mode Architecture Mapping

```
                                  +---------------------------------------+
                                  |         AWS Cloud Infrastructure      |
                                  |  - API Gateway WebSocket Relay        |
                                  |  - DynamoDB Hashed-IP Registry        |
                                  |  - STUN Reflexive Candidate Server    |
                                  +---------------------------------------+
                                                     |
                                            (Internet Backbone)
                                                     |
                        +----------------------------+----------------------------+
                        |                                                         |
         +-----------------------------+                           +-----------------------------+
         |     Site A: Home / Office   |                           |    Site B: Remote Network   |
         |  Public IP: 203.0.113.10    |                           |  Public IP: 203.0.113.18    |
         |  LAN Subnet: 192.168.1.0/24 |                           |  LAN Subnet: 192.168.2.0/24 |
         +-----------------------------+                           +-----------------------------+
            |                       |                                             |
   +-----------------+     +-----------------+                           +-----------------+
   |    Laptop A     |     |    Laptop B     |                           |    Laptop C     |
   | 192.168.1.101   |     | 192.168.1.102   |                           | 192.168.2.101   |
   +-----------------+     +-----------------+                           +-----------------+
            \                       /                                             |
             \== WebRTC DataChannel /                                             |
                (Local LAN Direct)                                                |
                 Sub-5ms Latency                                        Mode 2 Fallback:
                 Zero Cloud Egress                                      6-digit Code Sync
                 AES-256-GCM E2EE                                       via AWS Cloud Relay
```

1. **Mode 1: Ambient Same-IP Direct Connect (Local LAN / Wi-Fi)**
   - **Trigger:** Devices connected to the same local router (`R_HOME`) share a common public IPv4 address (`203.0.113.10`) via NAT/PAT Overload.
   - **Discovery:** Each client connects to AWS API Gateway WebSocket. The backend extracts `requestContext.identity.sourceIp`, hashes it with a server-side salt (`SHA256(Salt + IP)`), and matches devices within the same hash bucket in DynamoDB.
   - **P2P Direct WebRTC:** Signaling exchanges SDP and ICE candidates. RFC 5245 prioritizes the direct `host <-> host` pair (`192.168.1.101 <-> 192.168.1.102`) over `srflx`. 
   - **Zero AWS Cost:** Once connected, raw clipboard payloads flow directly through the local switch (`SW_HOME`) / Access Point (`AP_HOME`). No payload touches the WAN router or AWS servers ($0.00 cloud egress).
2. **Mode 2: Universal 6-Digit Code Pairing Fallback (WAN Relay)**
   - **Trigger:** When devices reside on different networks (e.g., `Laptop_C` on `203.0.113.18` vs `Laptop_A` on `203.0.113.10`), public IP correlation fails.
   - **Fallback:** Users pair using a temporary 6-digit session code (e.g., `482910`). Encrypted payloads are relayed via the AWS API Gateway WebSocket server (`AWS_Relay` at `172.31.0.50`).

---

## 2. Computer Networking Concepts Demonstrated in Packet Tracer

This simulation visually demonstrates core networking principles studied in Cisco CCNA and distributed systems engineering:

| Networking Concept | Real-World Role in CopySync | Implementation in Packet Tracer |
| :--- | :--- | :--- |
| **NAT / PAT Overload** | Hides private subnets behind a single public IP. Enables CopySync's Public IP Correlation. | `ip nat inside source list 1 interface Gi0/0 overload` on `R_HOME` & `R_REMOTE`. |
| **DHCP Address Allocation** | Automatically assigns private IP, subnet mask, default gateway, and DNS to client laptops. | Router DHCP pools `LAN_HOME` (`192.168.1.0/24`) and `LAN_REMOTE` (`192.168.2.0/24`). |
| **OSPF Routing (Area 0)** | Core dynamic routing protocol interconnecting ISP, Home, Remote, and Cloud datacenters. | `router ospf 1` on `R_ISP` and `R_AWS` advertising point-to-point `/30` and cloud subnets. |
| **Default Routing (Edge Gateways)** | Directs all non-local outbound traffic to the ISP next-hop. | `ip route 0.0.0.0 0.0.0.0 203.0.113.9` on `R_HOME`. |
| **WebRTC ICE Candidate Resolution** | Distinguishes local `host` candidates (`192.168.1.x`) from reflexive `srflx` candidates (`203.0.113.10`). | `STUN_Server` (`172.31.0.60`) responds to STUN binding requests across the WAN. |
| **RFC 5245 Candidate Prioritization** | Mathematical preference formula that forces P2P packets across the switch instead of hair-pinning the WAN. | Packet inspection confirms ICMP/UDP flows stay on `SW_HOME` FastEthernet ports. |
| **802.11 Wireless Access Point** | Seamless Wi-Fi connectivity for roaming laptops. | `AccessPoint-PT` (`AP_HOME`) connected to `SW_HOME` port `Fa0/1`. |

---

## 3. Network Topology Architecture

### Visual Diagram

```
 [Laptop_A]       [Laptop_B]
 192.168.1.101    192.168.1.102
     (Fa0)            (Fa0)
       |                |
   [Fa0/2]          [Fa0/3]
+------------------------------------+
|          SW_HOME (2960)            |---[Fa0/1]--- [AP_HOME] (AccessPoint)
+------------------------------------+
                | [Gi0/1]
                |
                | [Gi0/1] (192.168.1.1/24 - Inside NAT)
       +------------------+
       |   R_HOME (2911)  |
       +------------------+
                | [Gi0/0] (203.0.113.10/30 - Outside NAT)
                |
                | (Cable: Cross)
                |
                | [Gi0/0] (203.0.113.9/30)
       +------------------+
       |   R_ISP (2911)   | <=== Core OSPF Area 0 Backbone
       +------------------+
        | [Gi0/1]         | [Gi0/2] (203.0.113.17/30)
        | (198.51.100.1)  |
        | (Cable: Cross)  | (Cable: Cross)
        |                 |
        | [Gi0/0]         | [Gi0/0] (203.0.113.18/30 - Outside NAT)
+------------------+   +------------------+
|   R_AWS (2911)   |   | R_REMOTE (2911)  |
+------------------+   +------------------+
        | [Gi0/1] (172.31.0.1/24) | [Gi0/1] (192.168.2.1/24 - Inside NAT)
        |                         |
+------------------+   +------------------+
|   SW_AWS (2960)  |   | SW_REMOTE (2960) |
+------------------+   +------------------+
   |             |              | [Fa0/1]
[Fa0/1]       [Fa0/2]           |
   |             |         [Laptop_C]
[AWS_Relay]  [STUN_Server] 192.168.2.101
172.31.0.50  172.31.0.60
```

---

## 4. Comprehensive IP Addressing Table

| Device Name | Device Model | Interface | IP Address | Subnet Mask | Default Gateway | Function / Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`R_HOME`** | Cisco 2911 | `Gi0/0` | `203.0.113.10` | `255.255.255.252` (`/30`) | `203.0.113.9` | Outside WAN link to ISP (PAT Overload address) |
| | | `Gi0/1` | `192.168.1.1` | `255.255.255.0` (`/24`) | N/A | Inside LAN gateway for Home/Office devices |
| **`SW_HOME`** | Cisco 2960-24TT | `VLAN 1` | Unmanaged | N/A | N/A | Layer 2 distribution for Site A |
| **`AP_HOME`** | AccessPoint-PT | `Port 0` | N/A (Bridge) | N/A | N/A | 802.11 b/g Access Point for wireless laptops |
| **`Laptop_A`** | Laptop-PT | `FastEthernet0` | `192.168.1.101` | `255.255.255.0` (`/24`) | `192.168.1.1` | CopySync Host (Same-IP Origin) |
| **`Laptop_B`** | Laptop-PT | `FastEthernet0` | `192.168.1.102` | `255.255.255.0` (`/24`) | `192.168.1.1` | CopySync Peer (Same-IP Receiver / Direct Connect) |
| **`R_ISP`** | Cisco 2911 | `Gi0/0` | `203.0.113.9` | `255.255.255.252` (`/30`) | N/A | Uplink to Home Router (`R_HOME`) |
| | | `Gi0/1` | `198.51.100.1` | `255.255.255.252` (`/30`) | N/A | Uplink to Cloud Router (`R_AWS`) |
| | | `Gi0/2` | `203.0.113.17` | `255.255.255.252` (`/30`) | N/A | Uplink to Remote Router (`R_REMOTE`) |
| **`R_AWS`** | Cisco 2911 | `Gi0/0` | `198.51.100.2` | `255.255.255.252` (`/30`) | `198.51.100.1` | WAN Uplink to ISP router |
| | | `Gi0/1` | `172.31.0.1` | `255.255.255.0` (`/24`) | N/A | AWS Cloud VPC Private Subnet Gateway |
| **`SW_AWS`** | Cisco 2960-24TT | `VLAN 1` | Unmanaged | N/A | N/A | AWS Cloud Datacenter switch |
| **`AWS_Relay`** | Server-PT | `FastEthernet0` | `172.31.0.50` | `255.255.255.0` (`/24`) | `172.31.0.1` | Simulates API Gateway WebSocket & DynamoDB |
| **`STUN_Server`**| Server-PT | `FastEthernet0` | `172.31.0.60` | `255.255.255.0` (`/24`) | `172.31.0.1` | Simulates STUN Server (`stun.l.google.com`) |
| **`R_REMOTE`** | Cisco 2911 | `Gi0/0` | `203.0.113.18` | `255.255.255.252` (`/30`) | `203.0.113.17` | Outside WAN link to ISP (PAT Overload address) |
| | | `Gi0/1` | `192.168.2.1` | `255.255.255.0` (`/24`) | N/A | Inside LAN gateway for Remote network |
| **`SW_REMOTE`**| Cisco 2960-24TT | `VLAN 1` | Unmanaged | N/A | N/A | Layer 2 switch for Site B |
| **`Laptop_C`** | Laptop-PT | `FastEthernet0` | `192.168.2.101` | `255.255.255.0` (`/24`) | `192.168.2.1` | Remote Client (Mode 2 Fallback via 6-digit Code) |

---

## 5. Cisco IOS CLI Configurations

All configuration files are saved in [`packet_tracer/CopySync_PacketTracer/`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/) and can be pasted directly into device CLI consoles.

### 5.1 Router `R_HOME` (Site A: Home Gateway with NAT/PAT Overload)
File: [`R_HOME_config.txt`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/R_HOME_config.txt)

```ios
enable
configure terminal
hostname R_HOME
no ip domain-lookup

! WAN Interface (Outside NAT)
interface GigabitEthernet0/0
 description WAN_TO_ISP
 ip address 203.0.113.10 255.255.255.252
 ip nat outside
 no shutdown
 exit

! LAN Interface (Inside NAT)
interface GigabitEthernet0/1
 description LAN_LOCAL_DEVICES
 ip address 192.168.1.1 255.255.255.0
 ip nat inside
 no shutdown
 exit

! DHCP Server for Home Subnet
ip dhcp excluded-address 192.168.1.1 192.168.1.10
ip dhcp pool LAN_HOME
 network 192.168.1.0 255.255.255.0
 default-router 192.168.1.1
 dns-server 8.8.8.8
 exit

! Port Address Translation (NAT Overload)
! Translates any source from 192.168.1.0/24 to public IP 203.0.113.10
access-list 1 permit 192.168.1.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/0 overload

! Default Route to ISP
ip route 0.0.0.0 0.0.0.0 203.0.113.9

end
write memory
```

### 5.2 Router `R_ISP` (Internet Service Provider Core Router)
File: [`R_ISP_config.txt`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/R_ISP_config.txt)

```ios
enable
configure terminal
hostname R_ISP
no ip domain-lookup

! Link to Site A (Home)
interface GigabitEthernet0/0
 description LINK_TO_R_HOME
 ip address 203.0.113.9 255.255.255.252
 no shutdown
 exit

! Link to AWS Cloud Datacenter
interface GigabitEthernet0/1
 description LINK_TO_AWS_CLOUD
 ip address 198.51.100.1 255.255.255.252
 no shutdown
 exit

! Link to Site B (Remote)
interface GigabitEthernet0/2
 description LINK_TO_R_REMOTE
 ip address 203.0.113.17 255.255.255.252
 no shutdown
 exit

! Dynamic OSPF Area 0 Backbone
router ospf 1
 router-id 1.1.1.1
 network 203.0.113.8 0.0.0.3 area 0
 network 198.51.100.0 0.0.0.3 area 0
 network 203.0.113.16 0.0.0.3 area 0
 exit

end
write memory
```

### 5.3 Router `R_AWS` (Cloud Datacenter Edge Router)
File: [`R_AWS_config.txt`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/R_AWS_config.txt)

```ios
enable
configure terminal
hostname R_AWS
no ip domain-lookup

! WAN Interface to ISP
interface GigabitEthernet0/0
 description WAN_TO_ISP
 ip address 198.51.100.2 255.255.255.252
 no shutdown
 exit

! AWS VPC Subnet Gateway
interface GigabitEthernet0/1
 description AWS_VPC_SUBNET
 ip address 172.31.0.1 255.255.255.0
 no shutdown
 exit

! OSPF Route Advertisement into Internet Core
router ospf 1
 router-id 2.2.2.2
 network 198.51.100.0 0.0.0.3 area 0
 network 172.31.0.0 0.0.0.255 area 0
 exit

end
write memory
```

### 5.4 Router `R_REMOTE` (Site B: Remote Network with Distinct Public IP)
File: [`R_REMOTE_config.txt`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/R_REMOTE_config.txt)

```ios
enable
configure terminal
hostname R_REMOTE
no ip domain-lookup

! WAN Interface (Outside NAT)
interface GigabitEthernet0/0
 description WAN_TO_ISP
 ip address 203.0.113.18 255.255.255.252
 ip nat outside
 no shutdown
 exit

! LAN Interface (Inside NAT)
interface GigabitEthernet0/1
 description LAN_REMOTE_DEVICES
 ip address 192.168.2.1 255.255.255.0
 ip nat inside
 no shutdown
 exit

! DHCP Server for Remote Subnet
ip dhcp excluded-address 192.168.2.1 192.168.2.10
ip dhcp pool LAN_REMOTE
 network 192.168.2.0 255.255.255.0
 default-router 192.168.2.1
 dns-server 8.8.8.8
 exit

! Port Address Translation (NAT Overload)
! Translates 192.168.2.0/24 to public IP 203.0.113.18
access-list 1 permit 192.168.2.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/0 overload

! Default Route to ISP
ip route 0.0.0.0 0.0.0.0 203.0.113.17

end
write memory
```

---

## 6. Verification & Traffic Flow Simulation

### Step 1: Same-IP Public Address Correlation Test
1. From `Laptop_A`, ping `AWS_Relay` (`172.31.0.50`):
   ```bash
   ping 172.31.0.50
   ```
2. From `Laptop_B`, ping `AWS_Relay` (`172.31.0.50`):
   ```bash
   ping 172.31.0.50
   ```
3. Open `R_HOME` CLI console and inspect the active NAT translation table:
   ```ios
   R_HOME# show ip nat translations
   Pro  Inside global          Inside local           Outside local         Outside global
   icmp 203.0.113.10:1         192.168.1.101:1        172.31.0.50:1         172.31.0.50:1
   icmp 203.0.113.10:2         192.168.1.102:2        172.31.0.50:2         172.31.0.50:2
   ```
   > **Observation:** Notice that both `Laptop_A` (`192.168.1.101`) and `Laptop_B` (`192.168.1.102`) present the exact same **Inside Global IP** (`203.0.113.10`) to the AWS server. In the CopySync Lambda backend, this evaluates to:
   > `hash(203.0.113.10) === hash(203.0.113.10)`  
   > Result: **Instant automatic pairing into the same discovery bucket.**

### Step 2: Mode 1 Direct WebRTC P2P Verification (Zero Cloud Egress)
1. In Packet Tracer, enter **Simulation Mode** (Shift + S).
2. Set the Event Filter to only capture `ICMP`, `HTTP`, and `TCP`.
3. From `Laptop_A`, ping `Laptop_B`:
   ```bash
   ping 192.168.1.102
   ```
4. Click **Capture / Forward** in the simulation controls.
   > **Observation:**
   > - The frame travels from `Laptop_A` -> `SW_HOME` -> `Laptop_B`.
   > - The frame **NEVER** crosses `R_HOME`'s `Gi0/0` outside interface.
   > - Cloud Datacenter (`AWS_Relay`) experiences **zero packets and $0.00 bandwidth consumption**.

### Step 3: Mode 2 Fallback Verification (Remote Network Mismatch)
1. From `Laptop_C` (Site B), ping `AWS_Relay` (`172.31.0.50`):
   ```bash
   ping 172.31.0.50
   ```
2. Open `R_REMOTE` CLI console and inspect NAT translations:
   ```ios
   R_REMOTE# show ip nat translations
   Pro  Inside global          Inside local           Outside local         Outside global
   icmp 203.0.113.18:1         192.168.2.101:1        172.31.0.50:1         172.31.0.50:1
   ```
   > **Observation:** `Laptop_C` presents public IP `203.0.113.18`.
   > - In CopySync: `hash(203.0.113.18) !== hash(203.0.113.10)`.
   > - Ambient auto-discovery gracefully declines pairing.
   > - The UI prompts `Laptop_C` for the 6-digit session code.
   > - Encrypted clipboard synchronization falls back to the WebSocket relay hosted on `AWS_Relay` (`172.31.0.50`).

---

## 7. How to Load and Run in Cisco Packet Tracer

You have three convenient ways to explore or run this project:

### Method 1: Open the Pre-Constructed `.pkt` File
1. Launch **Cisco Packet Tracer**.
2. Go to **File → Open…** (or press `Ctrl + O`).
3. Select [`CopySync_Network_Simulation.pkt`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/CopySync_Network_Simulation.pkt).
4. The complete topology with all routers, switches, servers, laptops, and links will appear on the canvas.

### Method 2: One-Click Script Execution via Script Editor
1. In Cisco Packet Tracer, open a new blank project.
2. Go to **Extensions → Scripting → Script Editor…**
3. Click **Open** and select [`deploy_script.js`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/deploy_script.js).
4. Click **Run**.
5. Packet Tracer will programmatically create all devices, wire cables, configure IP addresses, and write the `.pkt` file.

### Method 3: Live Control Center Bridge (MCP Live Deploy)
1. In Cisco Packet Tracer, go to **Extensions → Scripting → Configure PT Script Modules → Add…**
2. Select [`V5.2.pts`](file:///c:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/V5.2.pts) (already included in the folder).
3. Open **Extensions → MCP BUILDER**.
4. With the MCP Control Center window active, the `packet-tracer` MCP server maintains real-time command streaming, automated topology queries (`pt_query_topology`), and live ping verification (`pt_verify_connectivity`).
