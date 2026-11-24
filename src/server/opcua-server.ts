// The OPC UA server around the simulation. It listens on localhost unless
// told otherwise, with no encryption and anonymous access: it is meant for
// software on the same machine, and it serves a simulated plant.

import { mkdir } from 'node:fs/promises';
import { MessageSecurityMode, OPCUACertificateManager, OPCUAServer, SecurityPolicy } from 'node-opcua';
import { publishUnit, type SnapshotSource } from './address-space.ts';

export interface OpcUaServerOptions {
  /** Where to listen. 127.0.0.1 keeps the server to this machine. */
  readonly host: string;
  readonly port: number;
  /** Where the server keeps its self-signed certificate. Outside the repository. */
  readonly pkiFolder: string;
  readonly source: SnapshotSource;
}

export interface RunningServer {
  readonly endpointUrl: string;
  stop(): Promise<void>;
}

export async function startOpcUaServer(options: OpcUaServerOptions): Promise<RunningServer> {
  await mkdir(options.pkiFolder, { recursive: true });
  const certificateManager = new OPCUACertificateManager({
    rootFolder: options.pkiFolder,
    // On a local, unencrypted server there is nothing a client certificate would protect.
    automaticallyAcceptUnknownCertificate: true,
  });
  const server = new OPCUAServer({
    host: options.host,
    hostname: options.host === '127.0.0.1' ? 'localhost' : options.host,
    port: options.port,
    serverCertificateManager: certificateManager,
    securityModes: [MessageSecurityMode.None],
    securityPolicies: [SecurityPolicy.None],
    allowAnonymous: true,
    serverInfo: {
      applicationUri: 'urn:batch-plant-simulator',
      productUri: 'urn:batch-plant-simulator',
      applicationName: { text: 'Batch plant simulator' },
    },
    buildInfo: { productName: 'Batch plant simulator', manufacturerName: 'Batch plant simulator' },
  });
  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  if (addressSpace === null) throw new Error('Invariant broken: an initialized server has an address space');
  publishUnit(addressSpace.getOwnNamespace(), addressSpace.rootFolder.objects, options.source);
  await server.start();
  const endpointUrl = server.getEndpointUrl();
  return {
    endpointUrl,
    stop: () => server.shutdown(),
  };
}
