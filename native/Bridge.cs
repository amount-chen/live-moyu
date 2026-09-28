using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

class Bridge {
    const int Limit = 65536;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object OutputLock = new object(), PipeLock = new object();
    static Stream Output;
    static NamedPipeServerStream Current;
    static string PipeName { get { return "LiveMoyu-" + WindowsIdentity.GetCurrent().User.Value; } }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);

    static byte[] ReadExact(Stream source, int count) {
        byte[] data = new byte[count]; int offset = 0;
        while (offset < count) { int n = source.Read(data, offset, count - offset); if (n == 0) throw new EndOfStreamException(); offset += n; }
        return data;
    }
    static byte[] ReadFrame(Stream source) {
        int length = BitConverter.ToInt32(ReadExact(source, 4), 0);
        if (length <= 0 || length > Limit) throw new InvalidDataException("Frame size");
        return ReadExact(source, length);
    }
    static void WriteFrame(Stream target, byte[] data) {
        if (data.Length == 0 || data.Length > Limit) throw new InvalidDataException("Frame size");
        target.Write(BitConverter.GetBytes(data.Length), 0, 4); target.Write(data, 0, data.Length); target.Flush();
    }
    static byte[] Encode(object value) { return Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value)); }
    static void Emit(object value) { lock (OutputLock) { WriteFrame(Output, Encode(value)); } }
    static object Decode(byte[] data) { return new JavaScriptSerializer().DeserializeObject(Encoding.UTF8.GetString(data)); }
    static string Text(Dictionary<string, object> value, string key) { return value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
    static void Connections() {
        while (true) {
            var security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
            using (var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, Limit, Limit, security)) {
                pipe.WaitForConnection();
                lock (PipeLock) Current = pipe;
                Emit(new {scope = "local", type = "connected"});
                try { while (true) Emit(new {scope = "browser", payload = Decode(ReadFrame(pipe))}); }
                catch (IOException) {} catch (ArgumentException) {}
                finally { lock (PipeLock) Current = null; }
                Emit(new {scope = "local", type = "disconnected"});
            }
        }
    }
    static void Server() {
        new Thread(() => { try { Connections(); } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.Exit(2); } }) {IsBackground = true}.Start();
        Emit(new {scope = "local", type = "ready"});
        while (true) {
            var message = Decode(ReadFrame(Console.OpenStandardInput())) as Dictionary<string, object>;
            if (message == null) continue;
            if (Text(message, "scope") == "browser") {
                try { lock (PipeLock) { if (Current != null) WriteFrame(Current, Encode(message["payload"])); } }
                catch (IOException) { Emit(new {scope = "local", type = "disconnected"}); }
                continue;
            }
            string command = Text(message, "type"), id = Text(message, "id");
            if (command == "capture") {
                var handle = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(handle, out pid);
                Emit(new {scope = "local", type = "reply", id = id, hwnd = handle.ToInt64().ToString(), pid = pid});
            } else if (command == "restore") {
                long raw, expected; uint pid;
                bool restored = false;
                if (Int64.TryParse(Text(message, "hwnd"), out raw) && Int64.TryParse(Text(message, "expected"), out expected)) {
                    var target = new IntPtr(raw); GetWindowThreadProcessId(target, out pid);
                    if (IsWindow(target) && pid.ToString() == Text(message, "pid") && GetForegroundWindow() == new IntPtr(expected)) restored = SetForegroundWindow(target);
                }
                Emit(new {scope = "local", type = "reply", id = id, restored = restored});
            }
        }
    }
    static void Native(string[] args) {
        string id = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "extension-id.txt")).Trim();
        if (args.Length == 0 || args[0] != "chrome-extension://" + id + "/") throw new InvalidDataException("Origin");
        using (var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous)) {
            pipe.Connect(1500);
            new Thread(() => {
                try { while (true) { byte[] data = ReadFrame(pipe); lock (OutputLock) WriteFrame(Output, data); } }
                catch { Environment.Exit(0); }
            }) {IsBackground = true}.Start();
            Stream input = Console.OpenStandardInput();
            while (true) WriteFrame(pipe, ReadFrame(input));
        }
    }
    static int Main(string[] args) {
        Output = Console.OpenStandardOutput();
        try { if (args.Length == 1 && args[0] == "--server") Server(); else Native(args); return 0; }
        catch (EndOfStreamException) {return 0;}
        catch (Exception error) {Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 1;}
    }
}
