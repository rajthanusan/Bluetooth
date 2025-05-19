using System;
using System.Windows.Forms;

namespace BluetoothChatDesktop  // Changed from BluetoothChatDesktop to match Form1.cs
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Form1());
        }
    }
}