declare module "react-native-thermal-printer" {
  export interface PrintTcpOptions {
    ip: string;
    port?: number;
    payload: string;
    mmFeedPaper?: number;
    printerWidth?: number;
  }

  export interface PrintBluetoothOptions {
    macAddress: string;
    payload: string;
    mmFeedPaper?: number;
    printerWidth?: number;
  }

  export interface BluetoothDevice {
    deviceName: string;
    macAddress: string;
  }

  const ThermalPrinter: {
    printTcp(options: PrintTcpOptions): Promise<void>;
    printBluetooth(options: PrintBluetoothOptions): Promise<void>;
    getBluetoothDeviceList?(): Promise<BluetoothDevice[]>;
    defaultConfig?: any;
  };

  export default ThermalPrinter;
}
