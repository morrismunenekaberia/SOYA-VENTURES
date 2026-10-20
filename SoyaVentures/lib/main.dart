import 'package:flutter/material.dart';

void main() {
  runApp(const SoyaVenturesApp());
}

class SoyaVenturesApp extends StatelessWidget {
  const SoyaVenturesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SoyaVentures',
      home: Scaffold(
        appBar: AppBar(title: const Text('SoyaVentures')),
        body: const Center(child: Text('Testing Layouts & Routing on Linux!')),
      ),
    );
  }
}
